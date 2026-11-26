import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { staleTradeOperation } from '@/services/tradeOperation';
import type { Dispatch, SetStateAction } from 'react';
/**
 * Counter-offer panels keep the four inputs attached to their own dossier.
 * Synchronous operation locks and identity/dossier fences protect send and late adoption.
 */
import * as Haptics from 'expo-haptics';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTradeOperation, type TradeOperation } from '@/hooks/useTradeOperation';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { Alert } from 'react-native';

import { track } from '@/lib/analytics';

import type { MeetupDetails, MeetupSpot } from '@/types';
import { parseOfferAmount } from '../MakeOfferModal/types';

// Bornes du montant d'une contre-offre — la borne haute reflète le plafond
// serveur imposé par firestore.rules (offer.amount <= 50000). Tenue à jour à la
// main.
const MIN_OFFER_AMOUNT = 1;
const MAX_OFFER_AMOUNT = 50000;

// Lecture stricte du format `AAAA-MM-JJ HH:MM` (heure locale). Rend une Date
// valide ou null — évite le comportement dépendant du moteur de `new Date(str)`
// sur une entrée non ISO, et rejette les composants hors bornes.
const MEETUP_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

function parseMeetupDateTime(raw: string): Date | null {
  const match = MEETUP_DATETIME_RE.exec(raw);
  if (!match) return null;

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour || date.getMinutes() !== minute
  ) {
    return null;
  }
  return date;
}

export type CounterOfferPanel = 'price' | 'location' | 'time' | null;

interface UseCounterOfferDialogsParams {
  chatId: string;
  articleId?: string;
  messageId: string;
  amount: number;
  listedPrice?: number;
  meetup?: MeetupDetails;
  onCounterPrice?: (messageId: string, newAmount: number, message?: string, assertIntention?: () => void) => Promise<void>;
  onCounterLocation?: (messageId: string, newLocation: MeetupSpot, message?: string, assertIntention?: () => void) => Promise<void>;
  onCounterTime?: (messageId: string, newDateTime: Date, message?: string, assertIntention?: () => void) => Promise<void>;
}

export function useCounterOfferDialogs({
  chatId,
  articleId,
  messageId,
  amount,
  listedPrice,
  meetup,
  onCounterPrice,
  onCounterLocation,
  onCounterTime,
}: UseCounterOfferDialogsParams) {
  const showAdmissionError = useTradeAdmissionError();
  const [isCountering, setIsCountering] = useState(false);
  const [activeCounterPanel, setActiveCounterPanelState] = useState<CounterOfferPanel>(null);
  const [counterPriceAmount, setCounterPriceAmountState] = useState('');
  const [counterLocationName, setCounterLocationNameState] = useState('');
  const [counterDateTime, setCounterDateTimeState] = useState('');
  const [counterMessage, setCounterMessageState] = useState('');

  const intentRevision = useRef(0);
  const [intentVersion, setIntentVersion] = useState(0);
  const edit = <T,>(setter: Dispatch<SetStateAction<T>>) => (value: SetStateAction<T>) => { intentRevision.current++; setIntentVersion(intentRevision.current); setter(value); };
  const setActiveCounterPanel = edit(setActiveCounterPanelState);
  const setCounterPriceAmount = edit(setCounterPriceAmountState);
  const setCounterLocationName = edit(setCounterLocationNameState);
  const setCounterDateTime = edit(setCounterDateTimeState);
  const setCounterMessage = edit(setCounterMessageState);

  const context = useTradeOperation(JSON.stringify([chatId, articleId, messageId]));
  const [previousFocus, setPreviousFocus] = useState(context.focusRevision);
  if (previousFocus !== context.focusRevision) {
    setPreviousFocus(context.focusRevision);
    setIsCountering(false);
  }
  const dossierKey = JSON.stringify([chatId, articleId, messageId, useAuthStore.getState().user?.id, getAuthSessionGeneration()]);
  const [previousDossier, setPreviousDossier] = useState(dossierKey);
  if (previousDossier !== dossierKey) {
    setPreviousDossier(dossierKey);
    setIsCountering(false);
    setActiveCounterPanelState(null);
    setCounterPriceAmountState('');
    setCounterLocationNameState('');
    setCounterDateTimeState('');
    setCounterMessageState('');
  }
  const inputEpoch = intentVersion;
  const inputFingerprint = JSON.stringify([counterPriceAmount, counterLocationName, counterDateTime, counterMessage, activeCounterPanel]);
  const inputsRef = useRef(inputFingerprint);
  useLayoutEffect(() => { inputsRef.current = inputFingerprint; }, [inputFingerprint]);

  const handleCounterPrice = async () => {
    if (!context.isOriginCurrent() || intentRevision.current !== inputEpoch) return;
    const newAmount = parseOfferAmount(counterPriceAmount);
    if (!Number.isFinite(newAmount) || newAmount < Math.min(MIN_OFFER_AMOUNT, listedPrice ?? MIN_OFFER_AMOUNT)) {
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'price',
        original_amount_cents: Math.round(amount * 100),
        validation_result: 'invalid',
        success: false,
      });
      Alert.alert('Erreur', 'Veuillez entrer un montant valide');
      return;
    }

    if (newAmount > MAX_OFFER_AMOUNT) {
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'price',
        original_amount_cents: Math.round(amount * 100),
        new_amount_cents: Math.round(newAmount * 100),
        validation_result: 'too_high',
        success: false,
      });
      Alert.alert('Montant trop élevé', `Maximum ${MAX_OFFER_AMOUNT} $ CA`);
      return;
    }
    if (listedPrice != null && newAmount > listedPrice) {
      Alert.alert('Montant trop élevé', 'La contre-offre ne peut pas dépasser le prix affiché.');
      return;
    }

    if (!onCounterPrice) return;

    let operation: TradeOperation | null = null;
    try {
      operation = context.start();
      if (!operation) return;
      setIsCountering(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await onCounterPrice(messageId, newAmount, counterMessage || undefined, () => { context.assertCurrent(operation!); if (intentRevision.current !== inputEpoch) throw staleTradeOperation(); });
      context.assertCurrent(operation);
      if (intentRevision.current !== inputEpoch || inputsRef.current !== inputFingerprint) return;
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'price',
        original_amount_cents: Math.round(amount * 100),
        new_amount_cents: Math.round(newAmount * 100),
        validation_result: 'ok',
        success: true,
      });
      setActiveCounterPanel(null);
      setCounterPriceAmount('');
      setCounterMessage('');
    } catch (error) {
      if (operation && (!context.isCurrent(operation) || intentRevision.current !== inputEpoch)) return;
      if (__DEV__) console.error('Error counter offering:', error);
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'price',
        original_amount_cents: Math.round(amount * 100),
        new_amount_cents: Math.round(newAmount * 100),
        validation_result: 'ok',
        success: false,
      });
      // Le motif exact du serveur plutôt qu'un message générique : c'est lui
      // qui dit à l'utilisateur ce qu'il peut faire (« Cette offre n'est plus
      // en attente. », « Cette offre a expiré »).
      const detail = error instanceof Error && error.message ? error.message : "Impossible d'envoyer la contre-offre";
      if (!showAdmissionError(error, { isCurrent: () => !!operation && context.isCurrent(operation) && intentRevision.current === inputEpoch, retry: () => { void handleCounterPrice(); } })) Alert.alert('Erreur', detail);
    } finally {
      if (operation) {
        if (context.isCurrent(operation)) setIsCountering(false);
        context.finish(operation);
      }
    }
  };

  const handleCounterLocation = async () => {
    if (!context.isOriginCurrent() || intentRevision.current !== inputEpoch) return;
    const name = counterLocationName.trim();
    if (!name) {
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'location',
        validation_result: 'empty',
        success: false,
      });
      Alert.alert('Erreur', 'Veuillez entrer le nom du lieu');
      return;
    }

    if (!onCounterLocation || !meetup) return;

    // Build a new MeetupSpot using the same neighborhood as the original offer
    const newLocation: MeetupSpot = {
      name,
      category: 'other' as MeetupSpot['category'],
      neighborhood: meetup.location.neighborhood,
      isUserSuggested: true,
    };

    let operation: TradeOperation | null = null;
    try {
      operation = context.start();
      if (!operation) return;
      setIsCountering(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await onCounterLocation(messageId, newLocation, counterMessage || undefined, () => { context.assertCurrent(operation!); if (intentRevision.current !== inputEpoch) throw staleTradeOperation(); });
      context.assertCurrent(operation);
      if (intentRevision.current !== inputEpoch || inputsRef.current !== inputFingerprint) return;
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'location',
        neighborhood_id: meetup.location.neighborhood?.id,
        validation_result: 'ok',
        success: true,
      });
      setActiveCounterPanel(null);
      setCounterLocationName('');
      setCounterMessage('');
    } catch (error) {
      if (operation && (!context.isCurrent(operation) || intentRevision.current !== inputEpoch)) return;
      if (__DEV__) console.error('Error counter-offering location:', error);
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'location',
        neighborhood_id: meetup.location.neighborhood?.id,
        validation_result: 'ok',
        success: false,
      });
      // Le motif exact du serveur plutôt qu'un message générique : c'est lui
      // qui dit à l'utilisateur ce qu'il peut faire (« Cette offre n'est plus
      // en attente. », « Cette offre a expiré »).
      const detail = error instanceof Error && error.message ? error.message : "Impossible d'envoyer la contre-offre de lieu";
      if (!showAdmissionError(error, { isCurrent: () => !!operation && context.isCurrent(operation) && intentRevision.current === inputEpoch, retry: () => { void handleCounterLocation(); } })) Alert.alert('Erreur', detail);
    } finally {
      if (operation) {
        if (context.isCurrent(operation)) setIsCountering(false);
        context.finish(operation);
      }
    }
  };

  async function handleCounterTime() {
    if (!context.isOriginCurrent() || intentRevision.current !== inputEpoch) return;
    const raw = counterDateTime.trim();
    if (!raw) {
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'time',
        validation_result: 'empty',
        success: false,
      });
      Alert.alert('Erreur', 'Veuillez entrer une date et heure');
      return;
    }

    if (!onCounterTime) return;

    // Parse the documented `AAAA-MM-JJ HH:MM` format explicitly. `new Date(string)`
    // is implementation-defined for non-ISO inputs (engine-dependent, can silently
    // misparse), so we validate the shape and build the Date from numeric parts.
    const parsed = parseMeetupDateTime(raw);
    if (!parsed) {
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'time',
        validation_result: 'bad_format',
        success: false,
      });
      Alert.alert(
        'Format invalide',
        'Veuillez entrer une date au format "AAAA-MM-JJ HH:MM" (ex: 2026-06-01 14:30).',
      );
      return;
    }

    if (parsed <= new Date()) {
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'time',
        validation_result: 'past_date',
        success: false,
      });
      Alert.alert('Date passée', 'La date proposée doit être dans le futur.');
      return;
    }

    const hoursUntilMeetup = Math.round((parsed.getTime() - Date.now()) / 3600000);

    let operation: TradeOperation | null = null;
    try {
      operation = context.start();
      if (!operation) return;
      setIsCountering(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await onCounterTime(messageId, parsed, counterMessage || undefined, () => { context.assertCurrent(operation!); if (intentRevision.current !== inputEpoch) throw staleTradeOperation(); });
      context.assertCurrent(operation);
      if (intentRevision.current !== inputEpoch || inputsRef.current !== inputFingerprint) return;
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'time',
        hours_until_meetup: hoursUntilMeetup,
        validation_result: 'ok',
        success: true,
      });
      setActiveCounterPanel(null);
      setCounterDateTime('');
      setCounterMessage('');
    } catch (error) {
      if (operation && (!context.isCurrent(operation) || intentRevision.current !== inputEpoch)) return;
      if (__DEV__) console.error('Error counter-offering time:', error);
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'time',
        hours_until_meetup: hoursUntilMeetup,
        validation_result: 'ok',
        success: false,
      });
      // Le motif exact du serveur plutôt qu'un message générique : c'est lui
      // qui dit à l'utilisateur ce qu'il peut faire (« Cette offre n'est plus
      // en attente. », « Cette offre a expiré »).
      const detail = error instanceof Error && error.message ? error.message : "Impossible d'envoyer la contre-offre d'horaire";
      if (!showAdmissionError(error, { isCurrent: () => !!operation && context.isCurrent(operation) && intentRevision.current === inputEpoch, retry: () => { void handleCounterTime(); } })) Alert.alert('Erreur', detail);
    } finally {
      if (operation) {
        if (context.isCurrent(operation)) setIsCountering(false);
        context.finish(operation);
      }
    }
  };

  return {
    isCountering,
    activeCounterPanel,
    setActiveCounterPanel,
    counterPriceAmount,
    setCounterPriceAmount,
    counterLocationName,
    setCounterLocationName,
    counterDateTime,
    setCounterDateTime,
    counterMessage,
    setCounterMessage,
    handleCounterPrice,
    handleCounterLocation,
    handleCounterTime,
  };
}
