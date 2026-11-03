export const MIN_PARTICIPANTS = 4;
export const MAX_PARTICIPANTS = 30;
export const PARTICIPANT_OPTIONS = Array.from(
  { length: MAX_PARTICIPANTS - MIN_PARTICIPANTS + 1 },
  (_, index) => index + MIN_PARTICIPANTS
);
