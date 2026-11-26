import {useSyncExternalStore} from 'react';
import {getSupportProjectionGeneration,subscribeSupportProjection} from '@/services/supportProjectionGuard';
export function useSupportProjectionGeneration(){return useSyncExternalStore(subscribeSupportProjection,getSupportProjectionGeneration,getSupportProjectionGeneration);}
