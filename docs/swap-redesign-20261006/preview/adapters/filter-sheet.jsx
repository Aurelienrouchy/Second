// Filter contents are outside the visual review; real filter chips are rendered.
import React from 'react';import {View,Text,Pressable} from 'react-native';
export default React.forwardRef(function ReviewFilterSheet({onClose},ref){const[open,setOpen]=React.useState(false);React.useImperativeHandle(ref,()=>({show:()=>setOpen(true),hide:()=>{setOpen(false);onClose?.()}}));return open?<View><Text>Panneau de filtres (adaptateur de revue)</Text><Pressable accessibilityRole="button" onPress={()=>{setOpen(false);onClose?.()}}><Text>Fermer</Text></Pressable></View>:null;});
