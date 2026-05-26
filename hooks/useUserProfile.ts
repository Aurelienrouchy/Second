import { useQuery } from '@tanstack/react-query';

import { auth } from '@/config/firebaseConfig';
import { UserService } from '@/services/userService';
import { User } from '@/types';

const USER_PROFILE_KEY = (uid: string) => ['userProfile', uid] as const;

/**
 * Fetch a user's live profile (display name + avatar),
 * cached in React Query so a list of N chats only fires N requests
 * total — and a profile update flows to every place that reads the
 * same uid.
 *
 * Why this exists: chat documents store a snapshot of the participant's
 * displayName/userImage at chat-creation time. If the user later sets
 * or changes their avatar, every existing chat still shows the old
 * (often empty) value. This hook reads the live user doc instead.
 *
 * SECURITY: Firestore rules only allow reading your own user doc.
 * When the requested uid is NOT the current user, we call the
 * getUserPublicProfile Cloud Function (Admin SDK) to avoid a
 * "Missing or insufficient permissions" error.
 */
export function useUserProfile(uid: string | null | undefined) {
  return useQuery<User | null>({
    queryKey: USER_PROFILE_KEY(uid ?? ''),
    queryFn: () => {
      if (!uid) return Promise.resolve(null);
      // Direct Firestore read is only allowed for the current user's own doc
      const currentUid = auth.currentUser?.uid;
      if (currentUid && currentUid === uid) {
        return UserService.getUserById(uid);
      }
      // For any other user, go through the Cloud Function
      return UserService.getPublicProfile(uid);
    },
    enabled: !!uid,
    staleTime: 30 * 60 * 1000, // 30 min — names/avatars change rarely
    gcTime: 24 * 60 * 60 * 1000,
  });
}
