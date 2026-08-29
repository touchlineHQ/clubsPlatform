import { createContext, useContext } from 'react';
import type { ClubEntry } from '../types';

interface ClubContextValue {
  clubSlug: string;
  isMultiClub: boolean;
  clubs: ClubEntry[];
}

export const ClubContext = createContext<ClubContextValue>({
  clubSlug: '',
  isMultiClub: false,
  clubs: [],
});

/** Hook to access the current club context. */
export function useClub() {
  return useContext(ClubContext);
}
