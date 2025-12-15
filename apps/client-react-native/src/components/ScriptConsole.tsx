/**
 * Script Console Component
 * Interactive console for executing JavaScript on a selected peer.
 * Features:
 * - Input/output display
 * - Execution with timeout enforcement
 * - Output size limits
 * - Error handling and stack traces
 */

import React, {useState, useCallback, useRef, useMemo} from 'react';
import type {
  ListRenderItemInfo} from 'react-native';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface ConsoleEntry {
  id: string;
  type: 'input' | 'output' | 'error' | 'info';
  content: string;
  timestamp: number;
}

interface ScriptConsoleProps {
  host?: string;
  branch?: string;
  onScriptExecute?: (code: string, host: string, branch: string) => Promise<string>;
}

const CONSOLE_TIMEOUT_MS = 5000; // 5 second timeout
const MAX_OUTPUT_SIZE = 50000; // 50KB max output
const MAX_CONSOLE_ENTRIES = 100;

const ScriptConsoleComponent: React.FC<ScriptConsoleProps> = ({
  host = 'localhost:8080',
  branch = 'main',
  onScriptExecute,
}) => {
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [executing, setExecuting] = useState(false);
  const [totalOutputSize, setTotalOutputSize] = useState(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const outputSizeRef = useRef(0);

  /**
   * Add entry to console
   */
  const addEntry = useCallback((type: ConsoleEntry['type'], content: string) => {
    const sizeIncrease = content.length;
    const newSize = outputSizeRef.current + sizeIncrease;

    // Enforce output size limit
    if (newSize > MAX_OUTPUT_SIZE) {
      const entry: ConsoleEntry = {
        id: `${Date.now()}-truncated`,
        type: 'error',
        content: `[Output limit reached: ${MAX_OUTPUT_SIZE} bytes]`,
        timestamp: Date.now(),
      };
      setEntries((prev) => [...prev.slice(-MAX_CONSOLE_ENTRIES + 1), entry]);
      return;
    }

    outputSizeRef.current = newSize;
    setTotalOutputSize(newSize);

    const entry: ConsoleEntry = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      content,
      timestamp: Date.now(),
    };

    setEntries((prev) => [...prev.slice(-(MAX_CONSOLE_ENTRIES - 1)), entry]);
  }, []);

  /**
   * Execute script with timeout
   */
  const handleExecute = useCallback(async () => {
    if (!input.trim()) return;

    setExecuting(true);

    try {
      // Add input to console
      addEntry('input', `> ${input}`);

      // Clear old timeout if any
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Create promise race with timeout
      const executePromise = onScriptExecute
        ? onScriptExecute(input, host, branch)
        : mockExecuteScript(input);

      const timeoutPromise = new Promise<string>((_, reject) => {
        timeoutRef.current = setTimeout(() => {
          reject(new Error(`Script execution timeout (${CONSOLE_TIMEOUT_MS}ms)`));
        }, CONSOLE_TIMEOUT_MS);
      });

      const result = await Promise.race([executePromise, timeoutPromise]);

      // Clear timeout on success
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      addEntry('output', result);
      setInput('');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addEntry('error', errorMsg);
    } finally {
      setExecuting(false);
    }
  }, [input, host, branch, onScriptExecute, addEntry]);

  /**
   * Clear console
   */
  const handleClear = useCallback(() => {
    setEntries([]);
    outputSizeRef.current = 0;
    setTotalOutputSize(0);
  }, []);

  /**
   * Render single console entry
   */
  const renderEntry = useCallback(({item}: ListRenderItemInfo<ConsoleEntry>) => {
    const colors = {
      input: '#007AFF',
      output: '#000',
      error: '#dc3545',
      info: '#6c757d',
    };

    return (
      <Text style={[styles.entry, {color: colors[item.type]}]}>
        {item.content}
      </Text>
    );
  }, []);

  /**
   * Format output size
   */
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <View style={styles.container}>
      {/* Header with info */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Script Console</Text>
        <Text style={styles.headerInfo}>
          {host} / {branch}
        </Text>
        <View style={styles.statsContainer}>
          <Text style={styles.statsText}>
            Output: {formatSize(totalOutputSize)} / {formatSize(MAX_OUTPUT_SIZE)}
          </Text>
          <Text style={styles.statsText}>
            Entries: {entries.length} / {MAX_CONSOLE_ENTRIES}
          </Text>
        </View>
      </View>

      {/* Output area */}
      <View style={styles.outputArea}>
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderEntry}
          scrollEnabled={true}
          contentContainerStyle={styles.outputContent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              Execute scripts in the console below
            </Text>
          }
        />
      </View>

      {/* Input area */}
      <View style={styles.inputContainer}>
        {/* Examples dropdown info */}
        <View style={styles.examplesHint}>
          <Text style={styles.hintText}>
            💡 Try: fetch('http://...')</Text>
          <Text style={styles.hintText}>
            💡 Try: JSON.stringify({'{'}test: 'value'{'}'})</Text>
        </View>

        {/* Text input */}
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Enter JavaScript code..."
          placeholderTextColor="#999"
          multiline
          selectTextOnFocus
          editable={!executing}
          maxLength={10000}
        />

        {/* Button row */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.executeButton, executing && styles.buttonDisabled]}
            onPress={handleExecute}
            disabled={executing || !input.trim()}>
            {executing ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.buttonText}>Executing...</Text>
              </>
            ) : (
              <Text style={styles.buttonText}>Execute</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.clearButton]}
            onPress={handleClear}
            disabled={executing}>
            <Text style={styles.buttonText}>Clear</Text>
          </TouchableOpacity>
        </View>

        {/* Info text */}
        <Text style={styles.infoText}>
          Timeout: {CONSOLE_TIMEOUT_MS}ms • Max output: {formatSize(MAX_OUTPUT_SIZE)} •{' '}
          {executing ? 'Running...' : 'Ready'}
        </Text>
      </View>
    </View>
  );
};

/**
 * Mock script execution for development/testing
 */
async function mockExecuteScript(code: string): Promise<string> {
  // Simple mock that executes code and returns result
  try {
    // Create a limited global scope for the script
    const sandboxGlobals = {
      Math: Math,
      JSON: JSON,
      Date: Date,
      Array: Array,
      Object: Object,
      String: String,
      Number: Number,
      Boolean: Boolean,
      console: {
        log: (...args: unknown[]) => args.map(String).join(' '),
      },
    };

    // Create function from code with sandboxed globals
    const fn = new Function(...Object.keys(sandboxGlobals), `return (${code})`);
    const result = await fn(...Object.values(sandboxGlobals));

    if (result === undefined) {
      return '[undefined]';
    }
    if (typeof result === 'string') {
      return result;
    }
    return JSON.stringify(result, null, 2);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    flexDirection: 'column',
  },
  header: {
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  headerInfo: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  statsContainer: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 12,
  },
  statsText: {
    fontSize: 11,
    color: '#999',
    fontFamily: 'monospace',
  },
  outputArea: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  outputContent: {
    padding: 12,
  },
  emptyText: {
    color: '#999',
    fontSize: 14,
    fontStyle: 'italic',
  },
  entry: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  inputContainer: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  examplesHint: {
    backgroundColor: '#fffbea',
    borderBottomWidth: 1,
    borderBottomColor: '#ffeaa7',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  hintText: {
    fontSize: 11,
    color: '#9c6c00',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    margin: 12,
    padding: 10,
    fontSize: 13,
    fontFamily: 'monospace',
    backgroundColor: '#fff',
    maxHeight: 150,
  },
  buttonRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 8,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  executeButton: {
    flex: 1,
    backgroundColor: '#007AFF',
  },
  clearButton: {
    flex: 0.8,
    backgroundColor: '#6c757d',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  infoText: {
    fontSize: 11,
    color: '#999',
    fontFamily: 'monospace',
    paddingHorizontal: 12,
    paddingBottom: 10,
    textAlign: 'center',
  },
});

export const ScriptConsole = ScriptConsoleComponent;
export default ScriptConsoleComponent;
