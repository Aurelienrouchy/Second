"""Offline interactions on the actual RN route components, with fixture services.
Not a device E2E test: router destinations and mutations are recorded locally.
"""
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

folder=Path(__file__).parent
results=[]
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':390,'height':844})
    remote=[]
    errors=[]
    def local_only(route):
        url=urlsplit(route.request.url)
        if url.scheme in ('data','blob') or (url.hostname=='127.0.0.1' and url.port==4174):route.continue_()
        else:remote.append(url.hostname);route.abort()
    context.route('**/*',local_only)
    page=context.new_page()
    page.set_default_timeout(10000)
    page.on('pageerror',lambda error:errors.append(error.message))
    def load(query):
        page.goto(f'http://127.0.0.1:4174/?{query}',wait_until='networkidle')
        page.wait_for_function("document.querySelector('#root')?.innerText.trim().length>5")
    def activity(kind):return [item for item in page.evaluate('window.__swapPreviewActivity') if item['type']==kind]
    def repeated(locator):locator.evaluate('(element)=>{element.click();element.click();}')
    def passed(name):
        assert not errors,(name,errors)
        assert not remote,(name,remote)
        results.append({'case':name,'passed':True,'activity':page.evaluate('window.__swapPreviewActivity')})
        print(f'PASS {name}',flush=True)

    load('screen=home')
    page.get_by_text('Découvrir les articles',exact=True).click()
    assert activity('push')[0]['data']['pathname']=='/swap-zone'
    passed('home-to-catalogue')

    load('screen=catalogue')
    repeated(page.get_by_role('button',name=re.compile('^Veste en denim')))
    assert len(activity('push'))==1
    destination=activity('push')[0]['data']
    assert destination['pathname']=='/propose-swap'
    assert json.loads(destination['params']['receiverItems'])[0]['articleId']=='their-1'
    passed('catalogue-proposal-single-navigation')

    load('screen=catalogue&state=guest')
    page.get_by_text('Ajouter des articles',exact=True).click()
    assert len(activity('auth-required'))==1
    assert activity('mutation')==[]
    passed('guest-deposit-auth-gate')

    load('screen=proposal')
    submit=page.get_by_role('button',name=re.compile('Envoyer la proposition'))
    assert submit.get_attribute('aria-disabled')=='true'
    page.get_by_text('Ajouter des articles',exact=True).last.click()
    page.get_by_test_id('swap-select-mine-1').click()
    expect(page.get_by_test_id('swap-select-mine-1').get_by_text('Sélectionné',exact=True)).to_be_visible()
    page.get_by_role('button',name='Fermer et conserver la sélection',exact=True).click()
    expect(page.get_by_text('Chemise en lin',exact=True)).to_have_count(1)
    page.get_by_text('Ajouter des articles',exact=True).last.click()
    expect(page.get_by_test_id('swap-select-mine-1').get_by_text('Sélectionné',exact=True)).to_be_visible()
    page.get_by_text('Utiliser cette sélection',exact=True).click()
    expect(submit).to_be_enabled()
    page.screenshot(path=str(folder/'captures/after-proposal-ready.png'))
    passed('proposal-selection-preserved-and-prerequisites')
    repeated(submit)
    page.wait_for_function("document.body.innerText.includes('Votre proposition a été envoyée.')")
    assert len(activity('mutation'))==1
    payload=activity('mutation')[0]['data'][0]
    assert payload['initiatorItems'][0]['articleId']=='mine-1'
    assert payload['receiverItems'][0]['articleId']=='their-1'
    assert not payload.get('cashTopUp')
    passed('proposal-repeat-and-payment-disabled-payload')
    page.screenshot(path=str(folder/'captures/after-proposal-sent.png'))

    load('screen=mine')
    page.get_by_text('En attente',exact=True).click()
    expect(page.get_by_text('Échange accepté',exact=True)).to_have_count(0)
    assert page.get_by_text('Proposition envoyée',exact=True).count()==1
    assert page.get_by_text('Échange accepté',exact=True).count()==0
    page.get_by_text('Historique',exact=True).click()
    expect(page.get_by_text('Proposition envoyée',exact=True)).to_have_count(0)
    assert page.get_by_text('Échange terminé',exact=True).count()==1
    assert page.get_by_text('Proposition envoyée',exact=True).count()==0
    page.get_by_text('Noa D.',exact=True).click()
    destination=activity('push')[0]['data']
    assert destination['pathname']=='/swap/[id]' and destination['params']['id']=='preview-completed'
    passed('my-swaps-filters-and-detail-destination')

    load('screen=detail&role=receiver')
    repeated(page.get_by_role('button',name='Accepter la proposition',exact=True))
    page.wait_for_timeout(400)
    assert len(activity('mutation'))==1
    passed('received-proposal-repeat-accept')

    load('screen=detail&status=accepted')
    repeated(page.get_by_text('En main propre',exact=True))
    page.wait_for_timeout(400)
    assert len(activity('mutation'))==1
    assert activity('mutation')[0]['data']==['preview-swap','hand_delivery']
    passed('manual-meetup-mode-repeat')

    load('screen=detail&status=accepted')
    repeated(page.get_by_text('Envoi postal',exact=True))
    page.wait_for_timeout(400)
    assert len(activity('mutation'))==1
    assert activity('mutation')[0]['data']==['preview-swap','shipping']
    passed('existing-manual-postal-mode-preserved')

    load('screen=detail&status=payment_pending&legacy=yes')
    assert page.get_by_text('Régler le complément',exact=True).count()==0
    assert page.get_by_text(re.compile('paiements sont indisponibles')).count()>0
    assert activity('mutation')==[]
    passed('legacy-payment-no-enabled-checkout')

    load('screen=detail&state=missing')
    page.get_by_role('button',name=re.compile('Retour')).first.click()
    assert len(activity('back'))==1
    passed('unavailable-detail-back')
    context.close();browser.close()
(folder/'interaction-results.json').write_text(json.dumps({'passed':len(results),'nativeE2E':False,'pageErrors':errors,'remoteRequestsAttempted':remote,'cases':results},indent=2,ensure_ascii=False))
