import { createContext, useContext, useState, type ReactNode } from 'react';

interface SectionContextValue {
  activeSection: string;
  setActiveSection: (s: string) => void;
}

export const SectionContext = createContext<SectionContextValue>({
  activeSection: 'all',
  setActiveSection: () => {},
});

/** Provider component that manages the active team section selection and persists it to localStorage. */
export function SectionProvider({ children }: { children: ReactNode }) {
  const [activeSection, setActiveSectionState] = useState<string>(
    () => localStorage.getItem('activeSection') ?? 'all'
  );

  function setActiveSection(s: string) {
    setActiveSectionState(s);
    localStorage.setItem('activeSection', s);
  }

  return (
    <SectionContext.Provider value={{ activeSection, setActiveSection }}>
      {children}
    </SectionContext.Provider>
  );
}

/** Hook to access the current section context. */
export function useSection() {
  return useContext(SectionContext);
}
