import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';

vi.mock('../config/firebase',()=>({db:{}}));
vi.mock('../config/shipEngine',()=>({getShipEngine:vi.fn(),savedLifecycleLabelIdentity:vi.fn()}));
vi.mock('./returnRequest',()=>({returnHash:vi.fn(),committedReturnReceipt:vi.fn()}));
vi.mock('./eligibility',()=>({assertAccountSecurityOpen:vi.fn(),assertRecentAccountAuthentication:vi.fn()}));
vi.mock('./notifications',()=>({prepareOperationalNotices:vi.fn(),readOperationalNoticeReceipts:vi.fn()}));
vi.mock('./rateLimit',()=>({checkRateLimit:vi.fn()}));
vi.mock('./supportRequest',()=>({supportHash:(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),
  supportSourceHash:vi.fn(),supportAdmin:vi.fn(),supportCurrentAdminSession:vi.fn(),supportId:vi.fn(),supportObject:vi.fn(),
  supportRequestId:vi.fn(),supportText:vi.fn(),supportUid:vi.fn()}));

import {getShipEngine} from '../config/shipEngine';
import {qualifiedReturnPdfUrl,qualifyReturnLabelDocument} from './returnDepositDeadline';

const env={GCLOUD_PROJECT:'seconde-dev',SECONDE_ENV:'development',SECONDE_COMMERCE_TEST_MODE:'true',
  FINANCIAL_RECOVERY_ENVIRONMENT:'test',SHIPENGINE_API_KEY:'TEST_fixture',SHIPENGINE_SANDBOX_ENABLED:'true',
  SHIPENGINE_ACCOUNT_ENVIRONMENT:'sandbox'};
const label='se-devsim-'+'a'.repeat(32),other='se-devsim-'+'b'.repeat(32);
const pdf=`https://firebasestorage.googleapis.com/v0/b/seconde-dev.firebasestorage.app/o/dev-commerce-labels%2F${label}.pdf?alt=media&token=11111111-1111-4111-8111-111111111111`;
const identity={labelId:label,direction:'return' as const,trackingNumber:'DEV'+'A'.repeat(32),carrierCode:'seconde_dev',
  shipmentId:'se-devsim-'+'c'.repeat(32),carrierId:'se-dev-simulation',serviceCode:'seconde_dev_standard',
  outboundLabelId:'se-devsim-'+'d'.repeat(32),rateId:null,providerCreatedAtMs:null};

beforeEach(()=>{
  for(const [key,value]of Object.entries(env))vi.stubEnv(key,value);
  for(const key of ['GCP_PROJECT','GOOGLE_CLOUD_PROJECT','SECONDE_PROJECT_ID','FIREBASE_CONFIG','FUNCTIONS_EMULATOR','SHIPENGINE_BASE_URL'])
    vi.stubEnv(key,undefined);
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks();});

it('qualifies only the exact generated Dev object and native label',()=>{
  expect(qualifiedReturnPdfUrl(pdf,label)).toBe(pdf);
  expect(qualifiedReturnPdfUrl(pdf,other)).toBeNull();
  for(const invalid of [pdf.replace('seconde-dev.firebasestorage.app','seconde-b47a6.firebasestorage.app'),
    pdf.replace('dev-commerce-labels%2F','drafts%2F'),pdf+'&token=22222222-2222-4222-8222-222222222222',
    pdf.replace('https:','http:'),pdf.replace('firebasestorage.googleapis.com','example.com'),pdf+'#other',pdf+'&redirect=1'])
    expect(qualifiedReturnPdfUrl(invalid,label)).toBeNull();
});
it('keeps production and disabled simulation closed to Firebase PDF URLs',()=>{
  vi.stubEnv('GCLOUD_PROJECT','seconde-b47a6');vi.stubEnv('SECONDE_ENV','production');
  expect(qualifiedReturnPdfUrl(pdf,label)).toBeNull();expect(qualifiedReturnPdfUrl(pdf)).toBeNull();
  vi.stubEnv('GCLOUD_PROJECT','seconde-dev');vi.stubEnv('SECONDE_ENV','development');vi.stubEnv('SECONDE_COMMERCE_TEST_MODE','false');
  expect(qualifiedReturnPdfUrl(pdf,label)).toBeNull();
  expect(qualifiedReturnPdfUrl('https://api.shipengine.com/v1/downloads/example.pdf')).toBe('https://api.shipengine.com/v1/downloads/example.pdf');
});
it('checks native identity on both sides of an actual bounded PDF read',async()=>{
  const read=vi.fn().mockResolvedValue({observation:'document_available',documentUrl:pdf});
  vi.mocked(getShipEngine).mockReturnValue({readCurrentLabelDocument:read} as never);
  const fetcher=vi.fn().mockResolvedValue(new Response('%PDF-1.4 test',{headers:{'Content-Type':'application/pdf'}}));vi.stubGlobal('fetch',fetcher);
  const result=await qualifyReturnLabelDocument(identity,true);
  expect(result).toMatchObject({documentUrl:pdf,byteLength:13});expect(read).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenCalledWith(pdf,expect.objectContaining({method:'GET',redirect:'error'}));
});
it('rejects a current provider URL naming another test label before fetching',async()=>{
  vi.mocked(getShipEngine).mockReturnValue({readCurrentLabelDocument:vi.fn().mockResolvedValue({observation:'document_available',documentUrl:pdf.replace(label,other)})} as never);
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  expect(await qualifyReturnLabelDocument(identity)).toBeNull();expect(fetcher).not.toHaveBeenCalled();
});
