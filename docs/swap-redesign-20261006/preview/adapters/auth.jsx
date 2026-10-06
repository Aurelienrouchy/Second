import {currentUser,record} from '../fixtures.mjs';
export const useUser=()=>currentUser;
export const useIsGuest=()=>!currentUser;
export const useIsLoading=()=>false;
export const useAuthSheetStore=selector=>selector({show:()=>record('auth-required'),open:()=>record('auth-required')});
export function useRequireAuth(){return {requireAuth:callback=>{if(currentUser){callback();return true;}record('auth-required');return false;}};}
