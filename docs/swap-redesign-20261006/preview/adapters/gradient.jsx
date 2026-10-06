import React from 'react';import {View} from 'react-native';
export function LinearGradient({colors,start,end,locations,style,...props}){return <View {...props} style={[style,{backgroundImage:`linear-gradient(180deg,${colors.join(',')})`}]}/>;}
