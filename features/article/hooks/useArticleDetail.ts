import {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {CancelledError, useQuery} from '@tanstack/react-query';
import {useShallow} from 'zustand/react/shallow';
import {auth} from '@/config/firebaseConfig';
import {queryKeys} from '@/lib/queryKeys';
import {ArticlesService} from '@/services/articlesService';
import {getAuthSessionGeneration, useAuthStore} from '@/store/authStore';
import type {Article} from '@/types';

/** Public content is readable by guests; current availability always needs a
 * fresh server read for this route, identity, focus and foreground visit. */
export function useArticleDetail(id: string | undefined) {
  const {uid, generation} = useAuthStore(useShallow(state => ({uid: state.authenticatedUid, generation: getAuthSessionGeneration()})));
  const scope = JSON.stringify([id, uid, generation]);
  const owner = useRef({scope, mounted: false, active: false, epoch: 0});
  const [visit, setVisit] = useState({scope, active: false, epoch: 0});
  useLayoutEffect(() => {
    owner.current.scope = scope; owner.current.mounted = true; owner.current.active = false; owner.current.epoch++;
    return () => {
      if (owner.current.scope !== scope) return;
      owner.current.mounted = false; owner.current.active = false; owner.current.epoch++;
    };
  }, [scope]);
  useFocusEffect(useCallback(() => {
    const publish = () => {
      if (!owner.current.mounted || owner.current.scope !== scope) return;
      owner.current.active = AppState.currentState === 'active'; owner.current.epoch++;
      setVisit({scope, active: owner.current.active, epoch: owner.current.epoch});
    };
    publish();
    let activity = AppState.currentState;
    const subscription = AppState.addEventListener('change', next => {
      if (next === activity) return;
      activity = next; publish();
    });
    return () => {
      subscription.remove();
      if (owner.current.scope !== scope) return;
      owner.current.active = false; owner.current.epoch++;
      if (owner.current.mounted) setVisit({scope, active: false, epoch: owner.current.epoch});
    };
  }, [scope]));
  const focused = visit.scope === scope && visit.active;
  // Keep the public detail prefix so all existing mutation invalidations still
  // apply. A previous visit's cached availability never enables this visit.
  const queryKey = [...queryKeys.articles.detail(id ?? ''), 'visit', uid, generation, visit.epoch] as const;
  const query = useQuery<Article | null>({queryKey, enabled: !!id && focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async ({signal}) => {
      const assertCurrent = () => {
        if (signal.aborted || !owner.current.mounted || !owner.current.active || owner.current.scope !== scope ||
          owner.current.epoch !== visit.epoch || AppState.currentState !== 'active' ||
          useAuthStore.getState().authenticatedUid !== uid || (auth.currentUser?.uid ?? null) !== uid ||
          getAuthSessionGeneration() !== generation) throw new CancelledError({revert: true});
      };
      assertCurrent();
      const article = await ArticlesService.getArticleById(id!, undefined, {source: 'server'});
      assertCurrent();
      return article;
    }});
  return {...query, queryKey, focused};
}
