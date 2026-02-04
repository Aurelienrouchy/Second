import { useState, useEffect, useCallback } from 'react';
import { httpsCallable } from '@react-native-firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { getActiveSwapParty, getUpcomingSwapParties } from '@/services/swapService';

export interface SwapPartyInfo {
  id: string;
  name: string;
  emoji: string;
  description?: string;
  theme?: string;
  isGeneralist: boolean;
  startDate?: string;
  endDate?: string;
  participantsCount?: number;
  itemsCount?: number;
  swapsCount?: number;
}

export interface SwapZoneData {
  hasActiveParty: boolean;
  activeParty: SwapPartyInfo | null;
  nextParty: SwapPartyInfo | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to get Swap Zone data for homepage
 */
export function useSwapZone(): SwapZoneData {
  const [hasActiveParty, setHasActiveParty] = useState(false);
  const [activeParty, setActiveParty] = useState<SwapPartyInfo | null>(null);
  const [nextParty, setNextParty] = useState<SwapPartyInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSwapZoneData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Call Cloud Function to get active party info
      const getActiveSwapPartyInfo = httpsCallable(functions, 'getActiveSwapPartyInfo');
      const result = await getActiveSwapPartyInfo({});
      const data = result.data as any;

      setHasActiveParty(data.hasActiveParty);
      setActiveParty(data.party);
      setNextParty(data.nextParty);
    } catch (err) {
      console.error('Error fetching swap zone data:', err);
      setError(err as Error);

      // Fallback to direct Firestore queries if cloud function fails
      try {
        const active = await getActiveSwapParty();
        if (active) {
          setHasActiveParty(true);
          setActiveParty({
            id: active.id,
            name: active.name,
            emoji: active.emoji,
            description: active.description,
            theme: active.theme,
            isGeneralist: active.isGeneralist,
            endDate: active.endDate?.toISOString(),
            participantsCount: active.participantsCount,
            itemsCount: active.itemsCount,
            swapsCount: active.swapsCount,
          });
          setNextParty(null);
        } else {
          setHasActiveParty(false);
          setActiveParty(null);

          const upcoming = await getUpcomingSwapParties(1);
          if (upcoming.length > 0) {
            const next = upcoming[0];
            setNextParty({
              id: next.id,
              name: next.name,
              emoji: next.emoji,
              description: next.description,
              theme: next.theme,
              isGeneralist: next.isGeneralist,
              startDate: next.startDate?.toISOString(),
              endDate: next.endDate?.toISOString(),
            });
          } else {
            setNextParty(null);
          }
        }
      } catch (fallbackErr) {
        console.error('Fallback also failed:', fallbackErr);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSwapZoneData();
  }, [fetchSwapZoneData]);

  return {
    hasActiveParty,
    activeParty,
    nextParty,
    isLoading,
    error,
    refresh: fetchSwapZoneData,
  };
}

/**
 * Calculate time remaining until a date
 */
export function useCountdown(targetDate: string | undefined): {
  days: number;
  hours: number;
  minutes: number;
  isExpired: boolean;
} {
  const [countdown, setCountdown] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    isExpired: false,
  });

  useEffect(() => {
    if (!targetDate) {
      setCountdown({ days: 0, hours: 0, minutes: 0, isExpired: true });
      return;
    }

    const calculateTimeLeft = () => {
      const target = new Date(targetDate);
      const now = new Date();
      const diff = target.getTime() - now.getTime();

      if (diff <= 0) {
        setCountdown({ days: 0, hours: 0, minutes: 0, isExpired: true });
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      setCountdown({ days, hours, minutes, isExpired: false });
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [targetDate]);

  return countdown;
}
