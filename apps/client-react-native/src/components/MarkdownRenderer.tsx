import React from 'react';
import { Text, View, Image, TouchableOpacity, ViewProps, TextProps } from 'react-native';
// @ts-ignore - markdown-to-jsx may not have types, but NativeWind's Babel plugin handles this
import Markdown from 'markdown-to-jsx';
import { ThemeManager } from '../utils/themeManager';

type Props = {
  content: string;
  onLinkPress?: (url: string) => void;
};

// Extend component props to allow className (NativeWind will handle at build time via Babel plugin)
interface StyledViewProps extends ViewProps {
  className?: string;
}

interface StyledTextProps extends TextProps {
  className?: string;
}

interface StyledTouchableProps extends ViewProps {
  className?: string;
  onPress?: () => void;
}

interface StyledImageProps {
  className?: string;
  source?: { uri: string };
  accessibilityLabel?: string;
  style?: any;
}

// Wrapper components that accept className
const StyledView = React.forwardRef<View, StyledViewProps>(
  ({ className, ...props }, ref) => <View ref={ref} {...(props as ViewProps)} />
);
StyledView.displayName = 'StyledView';

const StyledText = React.forwardRef<Text, StyledTextProps>(
  ({ className, ...props }, ref) => <Text ref={ref} {...(props as TextProps)} />
);
StyledText.displayName = 'StyledText';

const StyledTouchable = React.forwardRef<any, StyledTouchableProps>(
  ({ className, ...props }, ref) => (
    <TouchableOpacity ref={ref} {...(props as ViewProps & { onPress?: () => void })} />
  )
);
StyledTouchable.displayName = 'StyledTouchable';

const StyledImage: React.FC<StyledImageProps> = ({ className, ...props }) => (
  <Image {...(props as any)} />
);

// Basic Native components with NativeWind className support
const P: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledText className="text-base leading-6" style={{ color: colors.textPrimary }}>
      {children}
    </StyledText>
  );
};

const Strong: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledText className="font-bold" style={{ color: colors.textPrimary }}>
      {children}
    </StyledText>
  );
};

const Em: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledText className="italic" style={{ color: colors.textPrimary }}>
      {children}
    </StyledText>
  );
};

const CodeInline: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const t = ThemeManager.getTokens();
  return (
    <StyledText
      className="font-mono text-sm px-1 py-0.5 rounded"
      style={{ backgroundColor: t.colors.bgTertiary, color: t.colors.textPrimary }}
    >
      {children}
    </StyledText>
  );
};

const Pre: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const t = ThemeManager.getTokens();
  return (
    <StyledView className="p-3 rounded" style={{ backgroundColor: t.colors.bgTertiary }}>
      <StyledText className="font-mono text-sm" style={{ color: t.colors.textPrimary }}>
        {children}
      </StyledText>
    </StyledView>
  );
};

const H1: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledText className="text-2xl font-bold mt-4 mb-2" style={{ color: colors.textPrimary }}>
      {children}
    </StyledText>
  );
};

const H2: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledText className="text-xl font-bold mt-4 mb-2" style={{ color: colors.textPrimary }}>
      {children}
    </StyledText>
  );
};

const H3: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledText className="text-lg font-bold mt-3 mb-2" style={{ color: colors.textPrimary }}>
      {children}
    </StyledText>
  );
};

const HR: React.FC = () => {
  const colors = ThemeManager.getColors();
  return (
    <StyledView className="h-px my-3" style={{ backgroundColor: colors.border }} />
  );
};

const Blockquote: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const colors = ThemeManager.getColors();
  return (
    <StyledView
      className="pl-3"
      style={{ borderLeftWidth: 1, borderLeftColor: colors.border }}
    >
      <StyledText className="italic" style={{ color: colors.textSecondary }}>
        {children}
      </StyledText>
    </StyledView>
  );
};

const UL: React.FC<React.PropsWithChildren<{}>> = ({ children }) => (
  <StyledView className="gap-1 my-2">{children}</StyledView>
);

const OL: React.FC<React.PropsWithChildren<{}>> = ({ children }) => (
  <StyledView className="gap-1 my-2">{children}</StyledView>
);

const LI: React.FC<React.PropsWithChildren<{ ordered?: boolean; index?: number }>> = ({
  children,
}) => (
  <StyledView className="flex-row">
    <StyledText className="mr-2">•</StyledText>
    <StyledText className="flex-1 text-text-primary">{children}</StyledText>
  </StyledView>
);

const A: React.FC<
  React.PropsWithChildren<{ href?: string; onPress?: (url: string) => void }>
> = ({ children, href, onPress }) => {
  const colors = ThemeManager.getColors();
  const handle = () => {
    if (href && onPress) onPress(href);
  };
  return (
    <StyledTouchable onPress={handle}>
      <StyledText style={{ color: colors.primary }}>{children}</StyledText>
    </StyledTouchable>
  );
};

const IMG: React.FC<{ src?: string; alt?: string } & any> = ({ src, alt }) => {
  // RN requires explicit width/height or flex behavior; use a sensible default
  return (
    <StyledImage
      source={{ uri: src || '' }}
      accessibilityLabel={alt}
      style={{
        width: '100%',
        height: 200,
        resizeMode: 'contain',
      }}
    />
  );
};

export const MarkdownRenderer: React.FC<Props> = ({ content, onLinkPress }) => {
  // Ensure theme tokens are computed (side effect not needed, but call for consistency)
  void ThemeManager.getTokens();
  return (
    <StyledView className="p-3">
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
    </StyledView>
  );
};

export default MarkdownRenderer;
