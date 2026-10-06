import React from 'react';import {View,ScrollView,Pressable} from 'react-native';
const Sheet=React.forwardRef(function ReviewSheet({children,index=-1,onChange,onClose,onDismiss,footerComponent:Footer,backgroundStyle,handleIndicatorStyle,style},ref){
 const[open,setOpen]=React.useState(index>=0);const close=()=>{setOpen(false);onChange?.(-1);onClose?.();onDismiss?.();};
 React.useImperativeHandle(ref,()=>({present:()=>{setOpen(true);onChange?.(0)},expand:()=>{setOpen(true);onChange?.(0)},snapToIndex:i=>{setOpen(i>=0);onChange?.(i)},close,dismiss:close}));
 if(!open)return null;
 return <View style={{position:'absolute',inset:0,zIndex:100,backgroundColor:'rgba(0,0,0,.45)',justifyContent:'flex-end'}}><Pressable onPress={close} accessibilityLabel="Fermer le panneau" style={{flex:1,minHeight:80}}/><View style={[{height:'80%',backgroundColor:'#F8F6F1',borderTopLeftRadius:16,borderTopRightRadius:16,overflow:'hidden'},backgroundStyle,style]}>{children}{Footer?<Footer/>:null}</View></View>;
});
export const BottomSheetModal=Sheet;export default Sheet;
export const BottomSheetModalProvider=({children})=>children;
export const BottomSheetBackdrop=()=>null;export const BottomSheetFooter=({children})=><View>{children}</View>;
export const BottomSheetView=View,BottomSheetScrollView=ScrollView,TouchableOpacity=Pressable;
