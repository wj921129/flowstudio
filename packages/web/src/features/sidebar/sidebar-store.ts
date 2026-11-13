import { create } from 'zustand';
import { DEFAULT_THEME_ID } from './styles/theme-presets';

export type SidebarTab = 'templates' | 'elements' | 'styles';

export interface SidebarState {
  activeTab: SidebarTab;
  isCollapsed: boolean;
  activeThemeId: string;
  preserveManualStyles: boolean;
  searchKeyword: string;

  setActiveTab: (tab: SidebarTab) => void;
  toggleCollapsed: () => void;
  setIsCollapsed: (collapsed: boolean) => void;
  setActiveThemeId: (themeId: string) => void;
  setPreserveManualStyles: (preserve: boolean) => void;
  setSearchKeyword: (keyword: string) => void;
  reset: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  activeTab: 'elements',
  isCollapsed: false,
  activeThemeId: DEFAULT_THEME_ID,
  preserveManualStyles: true,
  searchKeyword: '',

  setActiveTab: (tab) =>
    set((state) => ({
      activeTab: tab,
      isCollapsed: state.isCollapsed && state.activeTab === tab ? false : false,
    })),
  toggleCollapsed: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
  setIsCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
  setActiveThemeId: (themeId) => set({ activeThemeId: themeId }),
  setPreserveManualStyles: (preserve) => set({ preserveManualStyles: preserve }),
  setSearchKeyword: (keyword) => set({ searchKeyword: keyword }),
  reset: () => set({ activeTab: 'elements', isCollapsed: false, searchKeyword: '' }),
}));
