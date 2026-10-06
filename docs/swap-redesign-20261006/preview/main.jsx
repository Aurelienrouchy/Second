import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View, Text, ScrollView } from 'react-native';
import HomeSwap from '@/features/home/swap-zone/SwapZoneSection';
import Catalogue from '@/app/swap-zone';
import Proposal from '@/app/propose-swap';
import MySwaps from '@/app/my-swaps';
import Detail from '@/app/swap/[id]';
import {scenario} from './fixtures.mjs';
import {colors,typography,spacing} from '@/constants/theme';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
class ReviewBoundary extends React.Component {state={error:null};static getDerivedStateFromError(error){return{error}};componentDidCatch(error){window.__swapPreviewError=error.message;}render(){return this.state.error?<Text accessibilityRole="alert">Erreur de rendu : {this.state.error.message}</Text>:this.props.children;}}
const screens={catalogue:Catalogue,proposal:Proposal,mine:MySwaps,detail:Detail};
const Screen=screens[scenario];
const Home=()=> <ScrollView style={{backgroundColor:colors.background}}><View style={{padding:spacing.lg,gap:spacing.sm}}><Text style={typography.h1}>Seconde</Text><Text style={typography.body}>Donnez une nouvelle vie aux articles que vous aimez.</Text></View><HomeSwap/><View style={{padding:spacing.lg}}><Text style={typography.h2}>À découvrir</Text></View></ScrollView>;
globalThis.__DEV__=false;
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><ReviewBoundary>{Screen?<Screen/>:<Home/>}</ReviewBoundary></QueryClientProvider>);
window.__swapPreviewReady=true;
