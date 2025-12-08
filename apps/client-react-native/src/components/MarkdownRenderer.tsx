import React from 'react';
import { Text, View, Image, TouchableOpacity } from 'react-native';
import Markdown from 'markdown-to-jsx';
import { ThemeManager } from '../utils/themeManager';

type Props = {
  content: string;
  onLinkPress?: (url: string) => void;
};

// Basic Native components with NativeWind className support
const P: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <Text className="text-base leading-6" style={{ color: colors.textPrimary }}>
      {children}
    </Text>
  );
};
const Strong: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return <Text className="font-bold" style={{ color: colors.textPrimary }}>{children}</Text>;
};
const Em: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return <Text className="italic" style={{ color: colors.textPrimary }}>{children}</Text>;
};
const CodeInline: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const t = ThemeManager.getTokens();
  return (
    <Text
      className="font-mono text-sm px-1 py-0.5 rounded"
      style={{ backgroundColor: t.colors.bgTertiary, color: t.colors.textPrimary }}
    >
      {children}
    </Text>
  );
};
const Pre: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const t = ThemeManager.getTokens();
  return (
    <View className="p-3 rounded" style={{ backgroundColor: t.colors.bgTertiary }}>
      <Text className="font-mono text-sm" style={{ color: t.colors.textPrimary }}>{children}</Text>
    </View>
  );
};
const H1: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return <Text className="text-2xl font-bold mt-4 mb-2" style={{ color: colors.textPrimary }}>{children}</Text>;
};
const H2: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return <Text className="text-xl font-bold mt-4 mb-2" style={{ color: colors.textPrimary }}>{children}</Text>;
};
const H3: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return <Text className="text-lg font-bold mt-3 mb-2" style={{ color: colors.textPrimary }}>{children}</Text>;
};
const HR: React.FC = () => {
  const colors = ThemeManager.getColors();
  return <View className="h-px my-3" style={{ backgroundColor: colors.border }} />;
};
const Blockquote: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <View className="pl-3" style={{ borderLeftWidth: 1, borderLeftColor: colors.border }}>
      <Text className="italic" style={{ color: colors.textSecondary }}>{children}</Text>
    </View>
  );
};

const UL: React.FC<React.PropsWithChildren<{}>> = ({ children }) => (
  <View className="gap-1 my-2">{children}</View>
);
const OL: React.FC<React.PropsWithChildren<{}>> = ({ children }) => (
  <View className="gap-1 my-2">{children}</View>
);
const LI: React.FC<React.PropsWithChildren<{ ordered?: boolean; index?: number }>> = ({ children }) => (
  <View className="flex-row">
    <Text className="mr-2">•</Text>
    <Text className="flex-1 text-text-primary">{children}</Text>
  </View>
);

const A: React.FC<React.PropsWithChildren<{ href?: string; onPress?: (url: string)=>void }>> = ({ children, href, onPress }) => {
  const colors = ThemeManager.getColors();
  const handle = () => {
    if (href && onPress) onPress(href);
  };
  return (
    <TouchableOpacity onPress={handle}>
      <Text style={{ color: colors.primary }}>{children}</Text>
    </TouchableOpacity>
  );
};

const IMG: React.FC<{ src?: string; alt?: string } & any> = ({ src, alt }) => {
  // RN requires explicit width/height or flex behavior; use a sensible default
  return (
    <Image source={{ uri: src || '' }} accessibilityLabel={alt} style={{ width: '100%', height: 200, resizeMode: 'contain' }} />
  );
};

export const MarkdownRenderer: React.FC<Props> = ({ content, onLinkPress }) => {
  // Ensure theme tokens are computed (side effect not needed, but call for consistency)
  void ThemeManager.getTokens();
  return (
    <View className="p-3">
      <Markdown
        options={{
          forceBlock: true,
          overrides: {
            p: { component: P },
            span: { component: Text },
            strong: { component: Strong },
            em: { component: Em },
            code: { component: CodeInline },
            pre: { component: Pre },
            h1: { component: H1 },
            h2: { component: H2 },
            h3: { component: H3 },
            hr: { component: HR },
            blockquote: { component: Blockquote },
            ul: { component: UL },
            ol: { component: OL },
            li: { component: LI },
            a: { component: (props: any) => <A {...props} onPress={onLinkPress} /> },
            img: { component: IMG },
          },
        }}
      >
        {content}
      </Markdown>
    </View>
  );
};

export default MarkdownRenderer;
