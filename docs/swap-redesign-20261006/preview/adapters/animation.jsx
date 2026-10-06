import React from 'react';import {View,Text,Image,ScrollView} from 'react-native';
const builder=new Proxy({}, {get:()=>()=>builder});
export const FadeInDown=builder,FadeIn=builder,FadeOut=builder,Layout=builder,LinearTransition=builder,ZoomIn=builder;
export const useSharedValue=value=>React.useMemo(()=>({value,get(){return this.value},set(v){this.value=v}}),[value]);
export const useAnimatedStyle=fn=>fn();
export const withTiming=value=>value,withSpring=value=>value,withRepeat=value=>value,withDelay=(_,value)=>value;
export const interpolate=(value,input,output)=>output[0]+(output.at(-1)-output[0])*value;
export const cancelAnimation=()=>{},runOnJS=fn=>fn;
export const Easing={out:fn=>fn,ease:value=>value};
function wrap(Component){const Adapted=React.forwardRef(function ReviewAnimated({entering,exiting,layout,...props},ref){return <Component {...props} ref={ref}/>;});return Adapted;}
export default {View:wrap(View),Text:wrap(Text),Image:wrap(Image),ScrollView:wrap(ScrollView),createAnimatedComponent:wrap};
