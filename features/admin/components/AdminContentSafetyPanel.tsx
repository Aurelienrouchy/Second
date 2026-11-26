import {useLayoutEffect,useRef,useState} from 'react';
import {StyleSheet,View} from 'react-native';
import {ContentSafetyPanel} from '@/components/ContentSafetyPanel';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {spacing} from '@/constants/theme';
import type {ContentSafetySelection} from '@/types/contentSafety';
import {AdminFinancialReauthentication} from './AdminFinancialReauthentication';
export function AdminContentSafetyPanel({selection,permitted}: {selection:ContentSafetySelection|null;permitted:boolean}) {
  const uid=useAuthenticatedUid(),base=useLabelLifecycleContext(JSON.stringify(['admin-content',selection,permitted]),uid),[verified,setVerified]=useState<string|null>(null);
  const key=JSON.stringify([base.frame,base.focusRevision,uid,selection,permitted]),current=useRef(key);
  useLayoutEffect(()=>{current.current=key;},[key]);
  return <View style={styles.group}>
    {uid&&permitted&&selection?<AdminFinancialReauthentication key={key} uid={uid} sourceKey={key} purpose="moderation" disabled={!base.focused} onVerified={()=>{try{if(current.current!==key)return;base.capture();setVerified(key);}catch{/* No stale private admission. */}}}/>:null}
    <ContentSafetyPanel scope="admin" selection={permitted?selection:null} readable={permitted&&verified===key&&base.focused}/>
  </View>;
}
const styles=StyleSheet.create({group:{gap:spacing.md}});
