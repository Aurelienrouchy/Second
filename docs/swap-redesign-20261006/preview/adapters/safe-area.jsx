import React from 'react';import {View} from 'react-native';
const insets={top:24,bottom:20,left:0,right:0};
export const useSafeAreaInsets=()=>insets;
export const SafeAreaProvider=({children})=>children;
export function SafeAreaView({edges=['top','bottom','left','right'],style,...props}){return <View {...props} style={[style,{paddingTop:edges.includes('top')?insets.top:0,paddingBottom:edges.includes('bottom')?insets.bottom:0}]}/>;}
