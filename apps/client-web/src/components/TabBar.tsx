import { useAppState } from '../state/store'

interface TabBarProps {
  onTabChange?: (tabId: string) => void
}

export function TabBar({ onTabChange }: TabBarProps) {
  const tabs = useAppState((s) => s.tabs)
  const activeTabId = useAppState((s) => s.activeTabId)
  const setActiveTab = useAppState((s) => s.setActiveTab)
  const closeTab = useAppState((s) => s.closeTab)

  if (tabs.length === 0) return null

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId)
    onTabChange?.(tabId)
  }

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    closeTab(tabId)
  }

  return (
    <div className="border-b border-gray-300 dark:border-gray-700 overflow-x-auto overflow-y-hidden">
      <div className="flex gap-1 p-0 min-h-11 items-center">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center gap-2 px-4 py-2 border border-gray-300 border-b-2 rounded-t-lg cursor-pointer transition-all flex-shrink-0 min-w-32 max-w-60 ${
              activeTabId === tab.id
                ? 'border-b-blue-500 font-semibold'
                : 'border-b-transparent hover:bg-gray-200 dark:hover:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
            }`}
            onClick={() => handleTabClick(tab.id)}
          >
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-gray-900 dark:text-gray-100" title={tab.title}>
              {tab.title}
            </span>
            {!tab.isHome && (
              <button
                className="bg-none border-none text-xl cursor-pointer text-gray-500 dark:text-gray-400 p-0 w-6 h-6 flex items-center justify-center rounded transition-all flex-shrink-0 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300"
                onClick={(e) => handleCloseTab(e, tab.id)}
                aria-label="Close tab"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
