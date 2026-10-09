'use client';

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface SidebarState {
  collapsed: boolean;
  toggleSidebar: () => void;
  expandSidebar: () => void;
  sidebarId: string;
  openButtonId: string;
  closeButtonId: string;
}

const SidebarContext = createContext<SidebarState | null>(null);

export function SidebarStateProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const restoreFocus = useRef(false);
  const sidebarId = useId();
  const openButtonId = `${sidebarId}-open`;
  const closeButtonId = `${sidebarId}-close`;

  useEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    document.getElementById(collapsed ? openButtonId : closeButtonId)?.focus();
  }, [collapsed, openButtonId, closeButtonId]);

  return (
    <SidebarContext.Provider value={{ collapsed, sidebarId, openButtonId, closeButtonId, expandSidebar: () => {
      restoreFocus.current = false;
      setCollapsed(false);
    }, toggleSidebar: () => {
      restoreFocus.current = true;
      setCollapsed(value => !value);
    } }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebarState() {
  return useContext(SidebarContext);
}
