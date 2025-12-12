import { useMemo } from 'react'
import { useTranspilerSetting, type TranspilerSetting } from '../state/transpilerSettings'

const OPTIONS: Array<{ value: TranspilerSetting; label: string; description: string }> = [
  {
    value: 'client-only',
    label: 'Prefer client-side transpiler',
    description:
      'Use the WASM hook transpiler that ships with the web app. Syntax errors will be reported directly from the client.',
  },
  {
    value: 'allow-server-fallback',
    label: 'Fallback to server transpiler on load failure',
    description:
      'If the WASM loader fails to initialize, request the server to transpile the hook instead. This is only executed when the local transpiler fails to load, not when a hook contains syntax problems.',
  },
]

export function SettingsTab() {
  const { setting, setSetting } = useTranspilerSetting()

  const selectedDescription = useMemo(
    () => OPTIONS.find((opt) => opt.value === setting)?.description,
    [setting]
  )

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Relay settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Control how hooks are transpiled and whether the server should act as a fallback for missing WASM.
        </p>
      </div>
      <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Transpiler behavior</h2>
            <p className="text-sm text-gray-500">Only the highlighted option will run.</p>
          </div>
        </div>
        <div className="space-y-3">
          {OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-3 rounded-lg border p-3 transition-shadow ${
                setting === option.value
                  ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-900/30 shadow'
                  : 'border-gray-200 dark:border-gray-700 bg-transparent'
              }`}
            >
              <input
                type="radio"
                name="transpilerSetting"
                value={option.value}
                checked={setting === option.value}
                onChange={() => setSetting(option.value)}
                className="mt-1"
              />
              <div>
                <p className="text-base font-medium text-gray-900">{option.label}</p>
                <p className="text-sm text-gray-500 mt-1">{option.description}</p>
              </div>
            </label>
          ))}
        </div>
        {selectedDescription && (
          <div className="text-sm text-gray-600">
            <p className="font-medium">Current behavior:</p>
            <p>{selectedDescription}</p>
          </div>
        )}
      </section>
    </div>
  )
}
