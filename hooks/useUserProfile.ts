import { useQuery } from '@tanstack/react-query';

import { UserService } from '@/services/userService';
import { User } from '@/types';

const USER_PROFILE_KEY = (uid: string) => ['userProfile', uid] as const;

/**
 * Fetch a user's live profile (display name + avatar) from Firestore,
 * cached in React Query so a list of N chats only fires N requests
 * total — and a profile update flows to every place that reads the
 * same uid.
 *
 * Why this exists: chat documents store a snapshot of the participant's
 * displayName/userImage at chat-creation time. If the user later sets
 * or changes their avatar, every existing chat still shows the old
 * (often empty) value. This hook reads the live user doc instead.
 */
export function useUserProfile(uid: string | null | undefined) {
  return useQuery<User | null>({
    queryKey: USER_PROFILE_KEY(uid ?? ''),
    queryFn: () => (uid ? UserService.getUserById(uid) : Promise.resolve(null)),
    enabled: !!uid,
    staleTime: 30 * 60 * 1000, // 30 min — names/avatars change rarely
    gcTime: 24 * 60 * 60 * 1000,
  });
}
