import React from 'react';import {Image as RNImage} from 'react-native';
export function Image({contentFit,recyclingKey,transition,cachePolicy,placeholder,placeholderContentFit,...props}){return <RNImage {...props} resizeMode={contentFit==='contain'?'contain':'cover'}/>;}
