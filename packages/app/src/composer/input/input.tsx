import {
  useComposerEditingSession,
  useComposerFullscreen,
  type ComposerEditingSession,
} from "@/composer/editing-session";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  View,
  Text,
  useWindowDimensions,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  type LayoutChangeEvent,
} from "react-native";
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  forwardRef,
} from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { composerSurfaceStyle } from "@/styles/floating-surface";
import { GLASS_SURFACES_ENABLED } from "@/styles/glass-support";
import { ArrowUp, Mic, MicOff, CornerDownLeft, Plus, Square } from "lucide-react-native";
import { useDictation } from "@/hooks/use-dictation";
import { hasFinePointer } from "@/hooks/use-fine-pointer";
import { DictationOverlay } from "@/components/dictation-controls";
import { RealtimeVoiceOverlay } from "@/components/realtime-voice-overlay";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import { useVoiceOptional } from "@/contexts/voice-context";
import { useToast } from "@/contexts/toast-context";
import { resolveVoiceUnavailableMessage } from "@/utils/server-info-capabilities";
import {
  collectImageFilesFromClipboardData,
  filesToImageAttachments,
} from "@/utils/image-attachments-from-files";
import type { ComposerAttachment } from "@/attachments/types";
import type { ImageAttachment, MessagePayload, TextReplacement } from "@/composer/types";
import { focusWithRetries } from "@/utils/web-focus";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useIosHardwareKeyboardSubmit } from "@/hooks/use-ios-hardware-keyboard-submit";
import { formatShortcut, type ShortcutKey } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";
import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useComposerKeyboardScope } from "@/composer/keyboard-scope";
import { RenderProfile } from "@/utils/render-profiler";
import { ComposerInputPresentation } from "./presentation";
import { useComposerRenderedLines } from "./rendered-lines";
import { resolveComposerInputMode, type ComposerInputMode } from "@/composer/input-mode";
import type { NativePastedFile } from "@/composer/native-pasted-image";
import type { EditingTextInputProps } from "@/components/ui/text-input";
import {
  inlineSegmentsText,
  insertInlineBlockText,
  pickSkillText,
  type InlineBlock,
  type InlineSegment,
} from "@/inline-blocks";
import { AgentProfileIconProvider } from "@/inline-blocks/view";
import type { SkillPick } from "@/hooks/use-agent-autocomplete";
import {
  ComposerTextInput as ComposerTextInputBase,
  type ComposerTextInputHandle,
} from "./text-input";
import type {
  ComposerInputSnapshot,
  ComposerLiveSelection,
  ComposerSelectionChangeEventData,
  ComposerTextSelection,
} from "./text-input.types";

const ComposerTextInput = withUnistyles(ComposerTextInputBase, (theme) => ({
  placeholderTextColor: theme.colors.surface4,
}));
import {
  resolveSendTooltipLabel,
  resolveSubmitAccessibilityLabel,
  resolveVoiceAccessibilityLabel,
  resolveVoiceTooltipText,
} from "./labels";
import {
  applyDictationTranscript,
  computeCanStartDictation,
  queueComposerInput,
  resolveComposerSurfacePresentation,
  resolveComposerSurfaceText,
  resolveRetainedSelection,
  resolvePrimaryActions,
  type PrimaryActions,
  runAlternateSendAction,
  runDefaultSendAction,
  runMessageInputKeyboardAction,
  stopRealtimeVoice,
} from "./state";

const DEFAULT_SEND_KEYS: ShortcutKey[][] = [["Enter"]];
const COMPOSER_INPUT_DATASET = { composerInput: "" } as const;

export interface AttachmentMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  icon?: React.ReactElement | null;
}

export type { ComposerInputSnapshot };

export interface ComposerKeyPressEvent {
  key: string;
  preventDefault: () => void;
  input: ComposerInputSnapshot;
}

export interface MessageInputProps {
  editingSession?: ComposerEditingSession;
  submissionError?: React.ReactNode;
  value: string;
  /** 挂载时 value 的分段结构（草稿含块时），块恢复成块。 */
  valueSegments?: readonly InlineSegment[];
  /** segments 是 Web 输入框内容的分段结构；原生端没有。 */
  onChangeText: (text: string, segments?: readonly InlineSegment[]) => void;
  /** 输入框里 Agent mention 的 provider 图标按这个 host 解析。 */
  serverId?: string;
  onSubmit: (payload: MessagePayload) => void;
  /** When true, the submit button is enabled even without text or images (e.g. external attachment selected). */
  hasExternalContent?: boolean;
  /** When true, the submit button stays visible and can submit even with no content. */
  allowEmptySubmit?: boolean;
  /** Optional accessibility label for the primary submit button. */
  submitButtonAccessibilityLabel?: string;
  /** Optional testID for the primary submit button. */
  submitButtonTestID?: string;
  submitIcon?: "arrow" | "return";
  isSubmitDisabled?: boolean;
  isSubmitLoading?: boolean;
  /** When true, keep the grown input height after submit (text is preserved, not cleared). */
  preserveHeightOnSubmit?: boolean;
  attachments: ComposerAttachment[];
  cwd: string;
  attachmentMenuItems: AttachmentMenuItem[];
  onAttachButtonRef?: (node: View | null) => void;
  onAddImages?: (images: ImageAttachment[]) => void;
  onPasteImages?: (files: readonly NativePastedFile[]) => void;
  client: DaemonClient | null;
  /** Dictation start gate from host runtime (socket connected + directory ready). */
  isReadyForDictation?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  autoFocusKey?: string;
  disabled?: boolean;
  /** Content to render on the left side of the composer toolbar (e.g., AgentControls) */
  leftContent?: React.ReactNode;
  /** Content to render on the right side before the voice button (e.g., context window meter) */
  beforeVoiceContent?: React.ReactNode;
  /** Auxiliary content to render on the right side after the voice button. */
  rightContent?: React.ReactNode;
  /** Stop action, shown for as long as the agent runs; Send joins it once there is a draft. */
  activeActionContent?: React.ReactNode;
  voiceServerId?: string;
  voiceAgentId?: string;
  /** When true and there's sendable content, calls onQueue instead of onSubmit */
  isAgentRunning?: boolean;
  /** Controls what the default send action (Enter, send button, dictation) does when the agent is
   *  running. "interrupt" and "steer" send immediately, "queue" queues. Required so the default
   *  lives only in DEFAULT_CLIENT_SETTINGS. */
  defaultSendBehavior: "interrupt" | "steer" | "queue";
  /** Callback for queue button when agent is running */
  onQueue?: (payload: MessagePayload) => void;
  /** Optional handler used when submit button is in loading state. */
  onSubmitLoadingPress?: () => void;
  /** Intercept key press events before default handling. Return true to prevent default. */
  onKeyPress?: (event: ComposerKeyPressEvent) => boolean;
  /** Reports cursor selection updates from the underlying input. */
  onSelectionChange?: (selection: ComposerLiveSelection) => void;
  onFocusChange?: (focused: boolean) => void;
  onHeightChange?: (height: number) => void;
  /** Extra styles merged onto the input wrapper (e.g. elevated background). */
  inputWrapperStyle?: import("react-native").ViewStyle;
  /** Content rendered inside the bordered input surface, above the text input (e.g. attachment pills). */
  attachmentSlot?: React.ReactNode;
  /** What this composer is for. See `@/composer/input-mode` for what each mode implies. */
  inputMode?: ComposerInputMode;
  /** Renders `value` as static text on the same surface, for content there is nothing to type into. */
  readOnly?: boolean;
  /** Command issued when application state must replace native-owned text. */
  textReplacement: TextReplacement;
  /** Replaces the submit icon with this label, still inside the composer's own toolbar row. */
  submitLabel?: string;
}

export interface MessageInputRef {
  focus: () => void;
  blur: () => void;
  getText: () => string;
  getInputSnapshot: () => ComposerInputSnapshot;
  replaceText: (text: string, selection?: { start: number; end: number }) => void;
  /** 当前内容的分段结构；原生端输入框只有文字，为 null。 */
  getSegments: () => InlineSegment[] | null;
  /** 以分段结构整体替换内容；原生端写入它的文字。 */
  replaceSegments: (segments: readonly InlineSegment[]) => void;
  /** 把 range 换成行内块并补一个空格；原生端输入框只有文字，插入块的链接文字。 */
  insertInlineBlock: (block: InlineBlock, range: ComposerTextSelection) => void;
  /**
   * 选中 skill：去掉 command 范围的 `/query`，Skill block 追加到开头块串末尾，光标回到原处；
   * 原生端输入框只有文字，把 `/name ` 插在开头已知 skill 之后。
   */
  pickSkillBlock: (pick: SkillPick) => void;
  runKeyboardAction: (action: MessageInputKeyboardActionKind) => boolean;
  /**
   * Web-only: return the underlying DOM element for focus assertions/retries.
   * May return null if not mounted or on native.
   */
  getNativeElement?: () => HTMLElement | null;
}

const MIN_INPUT_HEIGHT_MOBILE = 30;
const MIN_INPUT_HEIGHT_DESKTOP = 46;
const DEFAULT_MAX_INPUT_HEIGHT = 160;
const MAX_INPUT_VIEWPORT_RATIO = 0.5;
const MIN_INPUT_HEIGHT = isWeb ? MIN_INPUT_HEIGHT_DESKTOP : MIN_INPUT_HEIGHT_MOBILE;
type WebTextInputKeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    // Web-only: present on DOM KeyboardEvent during IME composition (CJK input).
    isComposing?: boolean;
    keyCode?: number;
  }
>;

function AttachButtonIcon({
  hovered,
  onAttachButtonRef,
  buttonIconSize,
}: {
  hovered: boolean;
  onAttachButtonRef: ((node: View | null) => void) | undefined;
  buttonIconSize: number;
}) {
  const colorMapping = hovered ? iconForegroundMapping : iconForegroundMutedMapping;
  return (
    <View ref={onAttachButtonRef} collapsable={false} style={styles.attachButtonAnchor}>
      <ThemedPlus size={buttonIconSize} uniProps={colorMapping} />
    </View>
  );
}

function AttachmentMenuList({ items }: { items: AttachmentMenuItem[] }) {
  return (
    <>
      {items.map((item) => (
        <DropdownMenuItem
          key={item.id}
          testID={`message-input-attachment-menu-item-${item.id}`}
          disabled={item.disabled}
          onSelect={item.onSelect}
          leading={item.icon ?? null}
        >
          {item.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function AttachmentDropdown({
  visible,
  isConnected,
  disabled,
  attachButtonStyle,
  renderAttachButtonIcon,
  attachmentMenuItems,
  addAttachmentLabel,
}: {
  visible: boolean;
  isConnected: boolean;
  disabled: boolean;
  attachButtonStyle: React.ComponentProps<typeof DropdownMenuTrigger>["style"];
  renderAttachButtonIcon: (input: { hovered?: boolean }) => React.ReactElement;
  attachmentMenuItems: AttachmentMenuItem[];
  addAttachmentLabel: string;
}) {
  const isButtonDisabled = !isConnected || disabled;
  if (!visible) return null;
  return (
    <DropdownMenu compactMode="sheet">
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            disabled={isButtonDisabled}
            accessibilityLabel={addAttachmentLabel}
            accessibilityRole="button"
            testID="message-input-attach-button"
            style={attachButtonStyle}
          >
            {renderAttachButtonIcon}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{addAttachmentLabel}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="end"
        offset={8}
        minWidth={220}
        testID="message-input-attachment-menu"
        sheetTitle={addAttachmentLabel}
      >
        <AttachmentMenuList items={attachmentMenuItems} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VoiceButtonIcon({
  hovered,
  isDictating,
  isMutedRealtime,
  buttonIconSize,
}: {
  hovered: boolean;
  isDictating: boolean;
  isMutedRealtime: boolean;
  buttonIconSize: number;
}) {
  if (isDictating) {
    return <Square size={buttonIconSize} color="white" fill="white" />;
  }
  const colorMapping = hovered ? iconForegroundMapping : iconForegroundMutedMapping;
  if (isMutedRealtime) {
    return <ThemedMicOff size={buttonIconSize} uniProps={colorMapping} />;
  }
  return <ThemedMic size={buttonIconSize} uniProps={colorMapping} />;
}

type ShortcutChord = NonNullable<React.ComponentProps<typeof Shortcut>["chord"]>;

function VoiceTooltipBody({
  voiceTooltipText,
  shortcut,
}: {
  voiceTooltipText: string;
  shortcut: ShortcutChord | null | undefined;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{voiceTooltipText}</Text>
      {shortcut ? <Shortcut chord={shortcut} /> : null}
    </View>
  );
}

function SendTooltipBody({
  label,
  sendKeys,
}: {
  label: string;
  sendKeys: ShortcutChord | null | undefined;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {sendKeys ? <Shortcut chord={sendKeys} /> : null}
    </View>
  );
}

function SendButtonContent({
  isSubmitLoading,
  submitIcon,
  submitLabel,
  buttonIconSize,
}: {
  isSubmitLoading: boolean;
  submitIcon: "arrow" | "return";
  submitLabel: string | undefined;
  buttonIconSize: number;
}) {
  if (isSubmitLoading) {
    return <ThemedLoadingSpinner size="small" uniProps={iconAccentForegroundMapping} />;
  }
  if (submitLabel) {
    return <Text style={styles.sendButtonLabel}>{submitLabel}</Text>;
  }
  if (submitIcon === "return") {
    return <ThemedCornerDownLeft size={buttonIconSize} uniProps={iconAccentForegroundMapping} />;
  }
  return <ThemedArrowUp size={buttonIconSize} uniProps={iconAccentForegroundMapping} />;
}

interface DesktopKeyPressContext {
  onKeyPressCallback: ((event: ComposerKeyPressEvent) => boolean) | undefined;
  input: ComposerKeyPressEvent["input"];
  submitOnEnter: boolean;
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  disabled: boolean;
  handleAlternateSendAction: () => void;
  handleDefaultSendAction: () => void;
}

function handleDesktopKeyPressImpl(
  event: WebTextInputKeyPressEvent,
  ctx: DesktopKeyPressContext,
): void {
  if (isImeComposingKeyboardEvent(event.nativeEvent)) return;

  if (ctx.onKeyPressCallback) {
    const handled = ctx.onKeyPressCallback({
      key: event.nativeEvent.key,
      preventDefault: () => event.preventDefault(),
      input: ctx.input,
    });
    if (handled) return;
  }

  const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;

  if (event.nativeEvent.key !== "Enter") return;
  if (!ctx.submitOnEnter) return;
  if (shiftKey) return;

  if ((metaKey || ctrlKey) && ctx.isAgentRunning && ctx.onQueue) {
    if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
    event.preventDefault();
    ctx.handleAlternateSendAction();
    return;
  }

  if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
  event.preventDefault();
  ctx.handleDefaultSendAction();
}

function getTextInputNativeElement(current: ComposerTextInputHandle | null): HTMLElement | null {
  if (!current) return null;
  const native = typeof current.getNativeRef === "function" ? current.getNativeRef() : current;
  return native instanceof HTMLElement ? native : null;
}

interface PasteImagesEffectArgs {
  getWebInputElement: () => HTMLElement | null;
  isConnected: boolean;
  disabled: boolean;
  isDictating: boolean;
  isRealtimeVoiceForCurrentAgent: boolean;
  onAddImages: ((images: ImageAttachment[]) => void) | undefined;
}

function usePasteImagesEffect(args: PasteImagesEffectArgs): void {
  const {
    getWebInputElement,
    isConnected,
    disabled,
    isDictating,
    isRealtimeVoiceForCurrentAgent,
    onAddImages,
  } = args;

  useEffect(() => {
    if (!isWeb || !onAddImages) return;

    const inputElement = getWebInputElement();
    if (!inputElement) return;

    let disposed = false;
    const handlePaste = (event: ClipboardEvent) => {
      if (!isConnected || disabled || isDictating || isRealtimeVoiceForCurrentAgent) return;

      const imageFiles = collectImageFilesFromClipboardData(event.clipboardData);
      if (imageFiles.length === 0) return;

      event.preventDefault();

      void filesToImageAttachments(imageFiles)
        .then((pastedAttachments) => {
          if (disposed || pastedAttachments.length === 0) return;
          onAddImages(pastedAttachments);
          return;
        })
        .catch((error) => {
          console.error("[MessageInput] Failed to process pasted images:", error);
        });
    };

    // 捕获阶段先于编辑器处理：收走图片后编辑器看到 defaultPrevented 就不再插入文字。
    inputElement.addEventListener("paste", handlePaste, true);
    return () => {
      disposed = true;
      inputElement.removeEventListener("paste", handlePaste, true);
    };
  }, [
    disabled,
    getWebInputElement,
    isConnected,
    isDictating,
    isRealtimeVoiceForCurrentAgent,
    onAddImages,
  ]);
}

function useAutoFocusOnWebEffect(
  textInputRef: React.MutableRefObject<ComposerTextInputHandle | null>,
  autoFocus: boolean,
  autoFocusKey: string | undefined,
): void {
  useEffect(() => {
    if (!isWeb || !autoFocus) return;
    return focusWithRetries({
      focus: () => textInputRef.current?.focus(),
      isFocused: () => {
        const element = getTextInputNativeElement(textInputRef.current);
        const active = typeof document !== "undefined" ? document.activeElement : null;
        return Boolean(element) && active === element;
      },
      deferInitialAttempt: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, autoFocusKey]);
}

function MessageInputAutoFocus({
  enabled,
  autoFocusKey,
  textInputRef,
}: {
  enabled: boolean;
  autoFocusKey: string | undefined;
  textInputRef: React.MutableRefObject<ComposerTextInputHandle | null>;
}) {
  const { isPaneFocused } = useComposerKeyboardScope();
  useAutoFocusOnWebEffect(textInputRef, enabled && isPaneFocused, autoFocusKey);
  return null;
}

function MessageInputOverlay({
  showDictationOverlay,
  showRealtimeOverlay,
  voice,
  dictationVolume,
  dictationDuration,
  isDictating,
  isDictationProcessing,
  dictationStatus,
  dictationError,
  onCancelRecording,
  onAcceptRecording,
  onAcceptAndSendRecording,
  onRetryFailedRecording,
  onDiscardFailedRecording,
  onRealtimeVoiceStop,
}: {
  showDictationOverlay: boolean;
  showRealtimeOverlay: boolean;
  voice:
    | {
        isMuted: boolean;
        isVoiceSwitching: boolean;
        toggleMute: () => void;
      }
    | null
    | undefined;
  dictationVolume: number;
  dictationDuration: number;
  isDictating: boolean;
  isDictationProcessing: boolean;
  dictationStatus: React.ComponentProps<typeof DictationOverlay>["status"];
  dictationError: string | null;
  onCancelRecording: () => Promise<void>;
  onAcceptRecording: () => Promise<void>;
  onAcceptAndSendRecording: () => Promise<void>;
  onRetryFailedRecording: () => void;
  onDiscardFailedRecording: () => void;
  onRealtimeVoiceStop: () => void;
}) {
  if (showDictationOverlay) {
    return (
      <DictationOverlay
        volume={dictationVolume}
        duration={dictationDuration}
        isRecording={isDictating}
        isProcessing={isDictationProcessing}
        status={dictationStatus}
        errorText={dictationStatus === "failed" ? (dictationError ?? undefined) : undefined}
        onCancel={onCancelRecording}
        onAccept={onAcceptRecording}
        onAcceptAndSend={onAcceptAndSendRecording}
        onRetry={dictationStatus === "failed" ? onRetryFailedRecording : undefined}
        onDiscard={dictationStatus === "failed" ? onDiscardFailedRecording : undefined}
      />
    );
  }
  if (showRealtimeOverlay && voice) {
    return (
      <RealtimeVoiceOverlay
        isMuted={voice.isMuted}
        isSwitching={voice.isVoiceSwitching}
        onToggleMute={voice.toggleMute}
        onStop={onRealtimeVoiceStop}
      />
    );
  }
  return null;
}

function FocusHint({
  visible,
  focusInputKeys,
  label,
}: {
  visible: boolean;
  focusInputKeys: ShortcutChord | null | undefined;
  label: string;
}) {
  const { isActiveComposer } = useComposerKeyboardScope();
  if (!isActiveComposer || !visible || !focusInputKeys || !label.trim()) return null;
  return (
    <Text style={styles.focusHintText} pointerEvents="none">
      {label}
    </Text>
  );
}

interface ComposerTextSurfaceProps {
  readOnly: boolean;
  value: string;
  valueSegments: readonly InlineSegment[] | undefined;
  serverId: string | null;
  textInputRef: React.Ref<ComposerTextInputHandle>;
  textInputStyle: EditingTextInputProps["style"];
  readOnlyTextStyle: React.ComponentProps<typeof Text>["style"];
  placeholder: string;
  accessibilityLabel: string;
  onChangeText: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  editable: boolean;
  autoFocus: boolean;
  onKeyPress: ((event: WebTextInputKeyPressEvent) => void) | undefined;
  onSelectionChange: (event: NativeSyntheticEvent<ComposerSelectionChangeEventData>) => void;
  onPasteImages: ((files: readonly NativePastedFile[]) => void) | undefined;
  onPasteError: (message: string) => void;
  textReplacementKey: string;
  fullscreen: boolean;
  compact: boolean;
  onRenderedLinesChange: (lines: number) => void;
  focusHintVisible: boolean;
  focusInputKeys: ShortcutChord | null | undefined;
  focusHintLabel: string;
}

/**
 * The composer's content: an editable input, or static text when there is
 * nothing to type. Both sit in the same bordered surface, so read-only is a
 * state of this composer rather than a second one.
 */
function ComposerTextSurface(props: ComposerTextSurfaceProps): React.ReactElement {
  const { onChangeText, onRenderedLinesChange } = props;
  // 原生端手机上用一段隐藏的同样式文字数行数，超过两行才给全屏按钮；Web 不测。
  const [measurementText, setMeasurementText] = useState(props.value);
  useEffect(() => {
    if (!isWeb) setMeasurementText(props.value);
  }, [props.value, props.textReplacementKey]);
  const handleTextChange = useCallback(
    (text: string) => {
      if (!isWeb) setMeasurementText(text);
      onChangeText(text);
    },
    [onChangeText],
  );
  const measureLines = useCallback(
    (event: import("react-native").TextLayoutEvent) =>
      onRenderedLinesChange(event.nativeEvent.lines.length),
    [onRenderedLinesChange],
  );
  if (props.readOnly) {
    return (
      <View style={styles.textInputScrollWrapper}>
        <Text style={props.readOnlyTextStyle} testID="composer-readonly-content">
          {props.value}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.textInputScrollWrapper, props.fullscreen && styles.fullscreenTextSurface]}>
      {!isWeb && props.compact && !props.fullscreen ? (
        <Text
          accessible={false}
          pointerEvents="none"
          style={[props.textInputStyle, styles.lineMeasurement]}
          onTextLayout={measureLines}
        >
          {`${measurementText}\u200b`}
        </Text>
      ) : null}
      <AgentProfileIconProvider serverId={props.serverId}>
        <ComposerTextInput
          ref={props.textInputRef}
          dataSet={COMPOSER_INPUT_DATASET}
          initialValue={props.value}
          initialSegments={props.valueSegments}
          inlineBlockServerId={props.serverId}
          onChangeText={handleTextChange}
          placeholder={props.placeholder}
          accessibilityLabel={props.accessibilityLabel}
          onFocus={props.onFocus}
          onBlur={props.onBlur}
          style={props.textInputStyle}
          multiline
          scrollEnabled
          editable={props.editable}
          onKeyPress={props.onKeyPress}
          onSelectionChange={props.onSelectionChange}
          onPasteImages={props.onPasteImages}
          onPasteError={props.onPasteError}
          autoFocus={props.autoFocus}
        />
      </AgentProfileIconProvider>
      <FocusHint
        visible={props.focusHintVisible}
        focusInputKeys={props.focusInputKeys}
        label={props.focusHintLabel}
      />
    </View>
  );
}

function VoiceButtonTooltip({
  visible,
  onVoicePress,
  isDictationStartEnabled,
  voiceButtonAccessibilityLabel,
  voiceButtonStyle,
  renderVoiceButtonIcon,
  voiceTooltipText,
  isRealtimeVoiceForCurrentAgent,
  voiceMuteToggleKeys,
  dictationToggleKeys,
}: {
  visible: boolean;
  onVoicePress: () => void;
  isDictationStartEnabled: boolean;
  voiceButtonAccessibilityLabel: string;
  voiceButtonStyle: React.ComponentProps<typeof TooltipTrigger>["style"];
  renderVoiceButtonIcon: (input: { hovered?: boolean }) => React.ReactElement;
  voiceTooltipText: string;
  isRealtimeVoiceForCurrentAgent: boolean;
  voiceMuteToggleKeys: ShortcutChord | null | undefined;
  dictationToggleKeys: ShortcutChord | null | undefined;
}) {
  const shortcut = isRealtimeVoiceForCurrentAgent ? voiceMuteToggleKeys : dictationToggleKeys;
  if (!visible) return null;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onVoicePress}
        disabled={!isDictationStartEnabled}
        accessibilityRole="button"
        accessibilityLabel={voiceButtonAccessibilityLabel}
        style={voiceButtonStyle}
      >
        {renderVoiceButtonIcon}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <VoiceTooltipBody voiceTooltipText={voiceTooltipText} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}

function SendButtonTooltip({
  shouldShow,
  canPressLoadingButton,
  onSubmitLoadingPress,
  onDefaultSendAction,
  isSendButtonDisabled,
  submitAccessibilityLabel,
  sendButtonCombinedStyle,
  isSubmitLoading,
  submitIcon,
  submitLabel,
  submitButtonTestID,
  buttonIconSize,
  sendKeys,
  sendTooltipLabel,
}: {
  shouldShow: boolean;
  canPressLoadingButton: boolean;
  onSubmitLoadingPress: (() => void) | undefined;
  onDefaultSendAction: () => void;
  isSendButtonDisabled: boolean;
  submitAccessibilityLabel: string;
  sendButtonCombinedStyle: React.ComponentProps<typeof TooltipTrigger>["style"];
  isSubmitLoading: boolean;
  submitIcon: "arrow" | "return";
  submitLabel: string | undefined;
  submitButtonTestID: string | undefined;
  buttonIconSize: number;
  sendKeys: ShortcutChord | null | undefined;
  sendTooltipLabel: string;
}) {
  if (!shouldShow) return null;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={canPressLoadingButton ? onSubmitLoadingPress : onDefaultSendAction}
        disabled={isSendButtonDisabled}
        accessibilityLabel={submitAccessibilityLabel}
        accessibilityRole="button"
        testID={submitButtonTestID}
        style={sendButtonCombinedStyle}
      >
        <SendButtonContent
          isSubmitLoading={isSubmitLoading}
          submitIcon={submitIcon}
          submitLabel={submitLabel}
          buttonIconSize={buttonIconSize}
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <SendTooltipBody label={sendTooltipLabel} sendKeys={sendKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

function resolveStopAction(actions: PrimaryActions, stop: React.ReactNode): React.ReactNode {
  return actions.showStop ? stop : null;
}

function hasSendableComposerContent(input: {
  hasText: boolean;
  attachments: readonly ComposerAttachment[];
  hasExternalContent: boolean;
}): boolean {
  return input.hasText || input.attachments.length > 0 || input.hasExternalContent;
}

interface ToggleRealtimeVoiceContext {
  voice:
    | {
        isVoiceSwitching: boolean;
        isVoiceModeForAgent: (serverId: string, agentId: string) => boolean;
        startVoice: (serverId: string, agentId: string) => Promise<unknown>;
      }
    | null
    | undefined;
  voiceServerId: string | undefined;
  voiceAgentId: string | undefined;
  isConnected: boolean;
  disabled: boolean;
  isAgentRunning: boolean;
  handleStopRealtimeVoice: () => Promise<unknown> | void;
  toast: { error: (msg: string) => void };
  interruptBeforeVoiceMessage: string;
  exitFullscreen: () => void;
}

function toggleRealtimeVoiceImpl(ctx: ToggleRealtimeVoiceContext): void {
  if (!ctx.voice || !ctx.voiceServerId || !ctx.voiceAgentId || !ctx.isConnected || ctx.disabled) {
    return;
  }
  if (ctx.voice.isVoiceSwitching) return;
  if (ctx.voice.isVoiceModeForAgent(ctx.voiceServerId, ctx.voiceAgentId)) {
    void ctx.handleStopRealtimeVoice();
    return;
  }
  if (ctx.isAgentRunning) {
    ctx.toast.error(ctx.interruptBeforeVoiceMessage);
    return;
  }
  ctx.exitFullscreen();
  void ctx.voice.startVoice(ctx.voiceServerId, ctx.voiceAgentId).catch((error) => {
    console.error("[MessageInput] Failed to start realtime voice", error);
    const message = extractErrorMessage(error);
    if (message && message.trim().length > 0) {
      ctx.toast.error(message);
    }
  });
}

interface StartDictationContext {
  dictationUnavailableMessage: string | null | undefined;
  canStartDictation: () => boolean;
  toast: { error: (msg: string) => void };
  startDictation: () => Promise<void>;
  exitFullscreen: () => void;
}

async function startDictationIfAvailableImpl(ctx: StartDictationContext): Promise<void> {
  if (ctx.dictationUnavailableMessage) {
    ctx.toast.error(ctx.dictationUnavailableMessage);
    return;
  }
  if (!ctx.canStartDictation()) {
    return;
  }
  ctx.exitFullscreen();
  await ctx.startDictation();
}

interface VoicePressContext {
  isRealtimeVoiceForCurrentAgent: boolean;
  voice: { toggleMute: () => void } | null | undefined;
  isDictating: boolean;
  cancelDictation: () => Promise<void> | void;
  startDictationIfAvailable: () => Promise<void>;
}

async function handleVoicePressImpl(ctx: VoicePressContext): Promise<void> {
  if (ctx.isRealtimeVoiceForCurrentAgent && ctx.voice) {
    ctx.voice.toggleMute();
    return;
  }
  if (ctx.isDictating) {
    await ctx.cancelDictation();
    return;
  }
  await ctx.startDictationIfAvailable();
}

interface SendMessageContext {
  value: string;
  attachments: ComposerAttachment[];
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  cwd: string;
  isAgentRunning: boolean;
  onSubmit: (payload: MessagePayload) => void;
  exitFullscreen: () => void;
}

function sendMessageImpl(ctx: SendMessageContext): void {
  const trimmed = ctx.value.trim();
  if (
    !trimmed &&
    ctx.attachments.length === 0 &&
    !ctx.hasExternalContent &&
    !ctx.allowEmptySubmit
  ) {
    return;
  }
  ctx.exitFullscreen();
  ctx.onSubmit({
    text: trimmed,
    attachments: ctx.attachments,
    cwd: ctx.cwd,
    forceSend: ctx.isAgentRunning || undefined,
  });
}

function computeIsRealtimeVoiceForAgent(
  voice: { isVoiceModeForAgent: (serverId: string, agentId: string) => boolean } | null | undefined,
  voiceServerId: string | undefined,
  voiceAgentId: string | undefined,
): boolean {
  if (!voice || !voiceServerId || !voiceAgentId) return false;
  return voice.isVoiceModeForAgent(voiceServerId, voiceAgentId);
}

function computeShouldShowDictationOverlay(
  isDictating: boolean,
  isDictationProcessing: boolean,
  dictationStatus: string,
): boolean {
  return isDictating || isDictationProcessing || dictationStatus === "failed";
}

function computeIsDictationStartEnabled(
  isReadyForDictation: boolean | undefined,
  isConnected: boolean,
  disabled: boolean,
): boolean {
  return (isReadyForDictation ?? isConnected) && !disabled;
}

function resolveMaxInputHeight(windowHeight: number, compact: boolean): number {
  if (compact) return DEFAULT_MAX_INPUT_HEIGHT;
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return DEFAULT_MAX_INPUT_HEIGHT;
  return Math.max(DEFAULT_MAX_INPUT_HEIGHT, Math.floor(windowHeight * MAX_INPUT_VIEWPORT_RATIO));
}

function getComposerInputSnapshot(
  current: ComposerTextInputHandle | null,
  fallbackText: string,
  fallbackSelection: ComposerLiveSelection,
): ComposerInputSnapshot {
  const text = current?.getText() ?? fallbackText;
  const { start, end, blockBoundary } = current?.getSelection?.() ?? fallbackSelection;
  return { text, selection: { start, end }, blockBoundary };
}

interface SendButtonStateInput {
  disabled: boolean;
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  onSubmitLoadingPress: (() => void) | undefined;
  defaultSendBehavior: "interrupt" | "steer" | "queue";
  isAgentRunning: boolean;
}

interface SendButtonStateOutput {
  canPressLoadingButton: boolean;
  isSendButtonDisabled: boolean;
  defaultActionQueues: boolean;
}

function computeSendButtonState(input: SendButtonStateInput): SendButtonStateOutput {
  const canPressLoadingButton =
    input.isSubmitLoading && typeof input.onSubmitLoadingPress === "function";
  const isSendButtonDisabled =
    input.disabled || (!canPressLoadingButton && (input.isSubmitDisabled || input.isSubmitLoading));
  const defaultActionQueues = input.defaultSendBehavior === "queue" && input.isAgentRunning;
  return { canPressLoadingButton, isSendButtonDisabled, defaultActionQueues };
}

interface ResolvedMessageInputProps {
  value: string;
  valueSegments: readonly InlineSegment[] | undefined;
  onChangeText: (text: string, segments?: readonly InlineSegment[]) => void;
  serverId: string | null;
  onSubmit: (payload: MessagePayload) => void;
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  submitButtonAccessibilityLabel: string | undefined;
  submitButtonTestID: string | undefined;
  submitIcon: "arrow" | "return";
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  preserveHeightOnSubmit: boolean;
  attachments: ComposerAttachment[];
  cwd: string;
  attachmentMenuItems: AttachmentMenuItem[];
  onAttachButtonRef: ((node: View | null) => void) | undefined;
  onAddImages: ((images: ImageAttachment[]) => void) | undefined;
  onPasteImages: ((files: readonly NativePastedFile[]) => void) | undefined;
  client: DaemonClient | null;
  isReadyForDictation: boolean | undefined;
  placeholder: string | undefined;
  autoFocus: boolean;
  autoFocusKey: string | undefined;
  disabled: boolean;
  leftContent: React.ReactNode;
  beforeVoiceContent: React.ReactNode;
  rightContent: React.ReactNode;
  activeActionContent: React.ReactNode;
  voiceServerId: string | undefined;
  voiceAgentId: string | undefined;
  isAgentRunning: boolean;
  defaultSendBehavior: "interrupt" | "steer" | "queue";
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onSubmitLoadingPress: (() => void) | undefined;
  onKeyPressCallback: ((event: ComposerKeyPressEvent) => boolean) | undefined;
  onSelectionChangeCallback: ((selection: ComposerLiveSelection) => void) | undefined;
  onFocusChange: ((focused: boolean) => void) | undefined;
  onHeightChange: ((height: number) => void) | undefined;
  inputWrapperStyle: import("react-native").ViewStyle | undefined;
  attachmentSlot: React.ReactNode;
  inputMode: ComposerInputMode;
  readOnly: boolean;
  textReplacement: TextReplacement;
  submitLabel: string | undefined;
}

function resolveMessageInputProps(props: MessageInputProps): ResolvedMessageInputProps {
  return {
    value: props.value,
    valueSegments: props.valueSegments,
    onChangeText: props.onChangeText,
    serverId: props.serverId ?? null,
    onSubmit: props.onSubmit,
    hasExternalContent: props.hasExternalContent ?? false,
    allowEmptySubmit: props.allowEmptySubmit ?? false,
    submitButtonAccessibilityLabel: props.submitButtonAccessibilityLabel,
    submitButtonTestID: props.submitButtonTestID,
    submitIcon: props.submitIcon ?? "arrow",
    isSubmitDisabled: props.isSubmitDisabled ?? false,
    isSubmitLoading: props.isSubmitLoading ?? false,
    preserveHeightOnSubmit: props.preserveHeightOnSubmit ?? false,
    attachments: props.attachments,
    cwd: props.cwd,
    attachmentMenuItems: props.attachmentMenuItems,
    onAttachButtonRef: props.onAttachButtonRef,
    onAddImages: props.onAddImages,
    onPasteImages: props.onPasteImages,
    client: props.client,
    isReadyForDictation: props.isReadyForDictation,
    placeholder: props.placeholder,
    autoFocus: props.autoFocus ?? false,
    autoFocusKey: props.autoFocusKey,
    disabled: props.disabled ?? false,
    leftContent: props.leftContent,
    beforeVoiceContent: props.beforeVoiceContent,
    rightContent: props.rightContent,
    activeActionContent: props.activeActionContent,
    voiceServerId: props.voiceServerId,
    voiceAgentId: props.voiceAgentId,
    isAgentRunning: props.isAgentRunning ?? false,
    defaultSendBehavior: props.defaultSendBehavior,
    onQueue: props.onQueue,
    onSubmitLoadingPress: props.onSubmitLoadingPress,
    onKeyPressCallback: props.onKeyPress,
    onSelectionChangeCallback: props.onSelectionChange,
    onFocusChange: props.onFocusChange,
    onHeightChange: props.onHeightChange,
    inputWrapperStyle: props.inputWrapperStyle,
    attachmentSlot: props.attachmentSlot,
    inputMode: props.inputMode ?? "chat",
    readOnly: props.readOnly ?? false,
    textReplacement: props.textReplacement,
    submitLabel: props.submitLabel,
  };
}

function resolvePresentationSendDisabled(input: {
  fullscreen: boolean;
  disabled: boolean;
  hasText: boolean;
  attachments: ComposerAttachment[];
  hasExternalContent: boolean;
  allowEmpty: boolean;
}): boolean {
  return (
    input.disabled || (input.fullscreen && !input.allowEmpty && !hasSendableComposerContent(input))
  );
}

function shouldShowFullscreenControl(
  compact: boolean,
  readOnly: boolean,
  overlayVisible: boolean,
  renderedLines: number,
) {
  return compact && !readOnly && !overlayVisible && renderedLines > 2;
}

function extractErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return null;
}

export const MessageInput = forwardRef<MessageInputRef, MessageInputProps>(
  function MessageInput(props, ref) {
    const {
      value,
      valueSegments,
      onChangeText,
      serverId,
      onSubmit,
      hasExternalContent,
      allowEmptySubmit,
      submitButtonAccessibilityLabel,
      submitButtonTestID,
      submitIcon,
      isSubmitDisabled,
      isSubmitLoading,
      preserveHeightOnSubmit,
      attachments,
      cwd,
      attachmentMenuItems,
      onAttachButtonRef,
      onAddImages,
      onPasteImages,
      client,
      isReadyForDictation,
      placeholder,
      autoFocus,
      autoFocusKey,
      disabled,
      leftContent,
      beforeVoiceContent,
      rightContent,
      activeActionContent,
      voiceServerId,
      voiceAgentId,
      isAgentRunning,
      defaultSendBehavior,
      onQueue,
      onSubmitLoadingPress,
      onKeyPressCallback,
      onSelectionChangeCallback,
      onFocusChange,
      onHeightChange,
      inputWrapperStyle,
      attachmentSlot,
      inputMode,
      readOnly,
      textReplacement,
      submitLabel,
    } = resolveMessageInputProps(props);
    const { isPaneFocused } = useComposerKeyboardScope();
    const mode = resolveComposerInputMode(inputMode);
    const { t } = useTranslation();
    const isCompact = useIsCompactFormFactor();
    const { height: windowHeight } = useWindowDimensions();
    const editingSession = useComposerEditingSession(inputMode, props.editingSession);
    const isFullscreen = useComposerFullscreen(editingSession);
    const [renderedLines, setRenderedLines] = useState(1);
    const maxInputHeight = resolveMaxInputHeight(windowHeight, isCompact);
    const buttonIconSize = isWeb ? ICON_SIZE.md : ICON_SIZE.lg;
    const toast = useToast();
    const voice = useVoiceOptional();
    const voiceMuteToggleKeys = useShortcutKeys("voice-mute-toggle");
    const dictationToggleKeys = useShortcutKeys("dictation-toggle");
    const focusInputKeys = useShortcutKeys("focus-message-input");
    const [isInputFocused, setIsInputFocused] = useState(false);
    // Web text is DOM-owned between deferred draft publications. The action button only needs
    // this boundary, so publish empty/non-empty transitions without rerendering for every key.
    const initialHasLiveText = value.trim().length > 0;
    const [hasLiveText, setHasLiveText] = useState(initialHasLiveText);
    const hasLiveTextRef = useRef(initialHasLiveText);
    const rootRef = useRef<View | null>(null);
    const inputWrapperRef = useRef<View | null>(null);
    const textInputRef = useRef<ComposerTextInputHandle | null>(null);
    const isInputFocusedRef = useRef(false);
    const focusIntentRef = useRef(false);
    const valueRef = useRef(value);
    const selectionRef = useRef<ComposerLiveSelection>({
      start: value.length,
      end: value.length,
      blockBoundary: 0,
    });
    const paneFocusedRef = useRef(isPaneFocused);
    paneFocusedRef.current = isPaneFocused;
    const [webInputElement, setWebInputElement] = useState<HTMLElement | null>(null);
    const appliedTextReplacementKeyRef = useRef(textReplacement.key);
    // One editor stays mounted through every layout mode, so this ref only follows
    // the editor's own mount and unmount.
    const assignTextInput = useCallback((input: ComposerTextInputHandle | null) => {
      textInputRef.current = input;
      if (isWeb) setWebInputElement(getTextInputNativeElement(input));
    }, []);
    // Only mouse-driven UIs restore editing focus on navigation. Touch users return
    // to the conversation; replaying old focus would reopen their software keyboard.
    // Read pointer capability when restoring, without making a pointer change itself
    // a focus trigger.
    useLayoutEffect(() => {
      if (isPaneFocused && focusIntentRef.current && hasFinePointer()) {
        textInputRef.current?.focus();
      }
    }, [isPaneFocused]);
    // The compact and desktop screens mount the editor in different trees, so a
    // viewport that crosses the breakpoint remounts it. The draft owner brings the
    // text back; the session brings the caret and focus intent back. On web the
    // owner may still hold an unpublished edit while the new editor mounts, so the
    // caret is placed now against the text on screen and again when the owner's
    // hydrated text arrives.
    const retainedSelectionRef = useRef<{ start: number; end: number } | null>(null);
    useLayoutEffect(() => {
      const retained = editingSession.takeEditor();
      if (retained) {
        const text = textInputRef.current?.getText() ?? valueRef.current;
        const selection = resolveRetainedSelection(retained.selection, text.length);
        retainedSelectionRef.current = retained.selection;
        selectionRef.current = { ...selection, blockBoundary: 0 };
        textInputRef.current?.setSelection(selection);
        if (retained.focused && hasFinePointer()) {
          focusIntentRef.current = true;
          if (paneFocusedRef.current) textInputRef.current?.focus();
        }
      }
      return () => {
        editingSession.retainEditor({
          selection: getComposerInputSnapshot(
            textInputRef.current,
            valueRef.current,
            selectionRef.current,
          ).selection,
          focused: isInputFocusedRef.current || focusIntentRef.current,
        });
      };
    }, [editingSession]);
    useComposerRenderedLines(webInputElement, isCompact && !isFullscreen, setRenderedLines);
    // 两端的输入都随内容自己长高，到 maxHeight 后在内部滚动。
    const composerHeightStyle = useMemo(
      () => ({ minHeight: MIN_INPUT_HEIGHT, maxHeight: maxInputHeight }),
      [maxInputHeight],
    );

    const exitFullscreen = useCallback(() => editingSession.setFullscreen(false), [editingSession]);
    const enterFullscreen = useCallback(() => editingSession.setFullscreen(true), [editingSession]);

    // The conversation sizes itself against the inline composer; fullscreen covers it.
    const handleComposerLayout = useCallback(
      (event: LayoutChangeEvent) => {
        if (!isFullscreen) onHeightChange?.(event.nativeEvent.layout.height);
      },
      [isFullscreen, onHeightChange],
    );

    const updateLiveTextPresence = useCallback((text: string) => {
      const nextHasLiveText = text.trim().length > 0;
      if (hasLiveTextRef.current === nextHasLiveText) return;
      hasLiveTextRef.current = nextHasLiveText;
      setHasLiveText(nextHasLiveText);
    }, []);

    const replaceText = useCallback(
      (nextText: string, selection?: { start: number; end: number }) => {
        valueRef.current = nextText;
        updateLiveTextPresence(nextText);
        const nextSelection = selection ?? { start: nextText.length, end: nextText.length };
        selectionRef.current = { ...nextSelection, blockBoundary: 0 };
        if (nextText === "") {
          textInputRef.current?.reset();
        } else {
          textInputRef.current?.replaceText(nextText, selection);
        }
        // 差异替换会保留没碰到的块，草稿随之保存替换后的分段结构。
        onChangeText(nextText, textInputRef.current?.getSegments?.());
      },
      [onChangeText, updateLiveTextPresence],
    );

    const replaceSegments = useCallback(
      (segments: readonly InlineSegment[]) => {
        const input = textInputRef.current;
        if (!input?.replaceSegments) {
          replaceText(inlineSegmentsText(segments));
          return;
        }
        input.replaceSegments(segments);
        const nextText = input.getText();
        valueRef.current = nextText;
        updateLiveTextPresence(nextText);
        selectionRef.current = { start: nextText.length, end: nextText.length, blockBoundary: 0 };
        onChangeText(nextText, input.getSegments?.());
      },
      [onChangeText, replaceText, updateLiveTextPresence],
    );

    useImperativeHandle(ref, () => ({
      focus: () => {
        textInputRef.current?.focus();
      },
      blur: () => {
        textInputRef.current?.blur();
      },
      getText: () => textInputRef.current?.getText() ?? valueRef.current,
      getInputSnapshot: () =>
        getComposerInputSnapshot(textInputRef.current, valueRef.current, selectionRef.current),
      replaceText,
      getSegments: () => textInputRef.current?.getSegments?.() ?? null,
      replaceSegments,
      insertInlineBlock: (block, range) => {
        const input = textInputRef.current;
        if (input?.insertInlineBlock) {
          input.insertInlineBlock(block, range);
          return;
        }
        const inserted = insertInlineBlockText({
          text: input?.getText() ?? valueRef.current,
          range,
          block,
        });
        replaceText(inserted.text, { start: inserted.cursor, end: inserted.cursor });
      },
      pickSkillBlock: ({ block, command, skillNames }) => {
        const input = textInputRef.current;
        if (input?.pickSkillBlock) {
          input.pickSkillBlock(block, command);
          return;
        }
        const picked = pickSkillText({
          text: input?.getText() ?? valueRef.current,
          command,
          name: block.name,
          skillNames,
        });
        replaceText(picked.text, { start: picked.cursor, end: picked.cursor });
      },
      runKeyboardAction: (action) =>
        runMessageInputKeyboardAction(action, {
          focusInput: () => textInputRef.current?.focus(),
          isDictationRecording: isDictationActive,
          markTranscriptForSend: () => {
            sendAfterTranscriptRef.current = true;
          },
          confirmDictation,
          cancelDictation,
          startDictation: startDictationIfAvailable,
          toggleRealtimeVoice: handleToggleRealtimeVoiceShortcut,
          isRealtimeVoiceActive: isRealtimeVoiceForCurrentAgent,
          toggleRealtimeVoiceMute: () => voice?.toggleMute(),
        }),
      getNativeElement: () => (isWeb ? getTextInputNativeElement(textInputRef.current) : null),
    }));
    const sendAfterTranscriptRef = useRef(false);
    const serverInfo = useSessionStore(
      useCallback(
        (state) => {
          if (!voiceServerId) {
            return null;
          }
          return state.sessions[voiceServerId]?.serverInfo ?? null;
        },
        [voiceServerId],
      ),
    );

    useEffect(() => {
      if (appliedTextReplacementKeyRef.current === textReplacement.key) return;
      appliedTextReplacementKeyRef.current = textReplacement.key;
      valueRef.current = textReplacement.text;
      updateLiveTextPresence(textReplacement.text);
      const retainedSelection =
        textReplacement.kind === "hydrated" && retainedSelectionRef.current
          ? resolveRetainedSelection(retainedSelectionRef.current, textReplacement.text.length)
          : undefined;
      retainedSelectionRef.current = null;
      if (retainedSelection) selectionRef.current = { ...retainedSelection, blockBoundary: 0 };
      const input = textInputRef.current;
      if (textReplacement.segments && input?.replaceSegments) {
        input.replaceSegments(textReplacement.segments, retainedSelection);
      } else if (textReplacement.text === "") {
        input?.reset();
      } else {
        input?.replaceText(textReplacement.text, retainedSelection);
      }
    }, [textReplacement, updateLiveTextPresence]);

    useEffect(() => {
      return () => {
        onFocusChange?.(false);
      };
    }, [onFocusChange]);

    const handleDictationTranscript = useCallback(
      (text: string, _meta: { requestId: string }) => {
        const autoSend = sendAfterTranscriptRef.current;
        sendAfterTranscriptRef.current = false;
        applyDictationTranscript(text, {
          value: valueRef.current,
          defaultSendBehavior,
          isAgentRunning,
          onQueue,
          onSubmit,
          replaceText,
          attachments,
          cwd,
          autoSend,
        });
      },
      [replaceText, onSubmit, onQueue, attachments, cwd, isAgentRunning, defaultSendBehavior],
    );

    const handleDictationError = useCallback(
      (error: Error) => {
        console.error("[MessageInput] Dictation error:", error);
        toast.error(error.message);
      },
      [toast],
    );

    const dictationUnavailableMessage = resolveVoiceUnavailableMessage({
      serverInfo,
      mode: "dictation",
    });

    const canStartDictation = useCallback(
      () =>
        computeCanStartDictation({
          client,
          isReadyForDictation,
          disabled,
          dictationUnavailableMessage,
        }),
      [client, disabled, dictationUnavailableMessage, isReadyForDictation],
    );

    const canConfirmDictation = useCallback(() => client?.isConnected ?? false, [client]);
    const isConnected = client?.isConnected ?? false;
    const isDictationStartEnabled = computeIsDictationStartEnabled(
      isReadyForDictation,
      isConnected,
      disabled,
    );

    const {
      isRecording: isDictating,
      isRecordingActive: isDictationActive,
      isProcessing: isDictationProcessing,
      partialTranscript: _dictationPartialTranscript,
      volume: dictationVolume,
      duration: dictationDuration,
      error: dictationError,
      status: dictationStatus,
      startDictation,
      cancelDictation,
      confirmDictation,
      retryFailedDictation,
      discardFailedDictation,
    } = useDictation({
      client,
      onTranscript: handleDictationTranscript,
      onError: handleDictationError,
      canStart: canStartDictation,
      canConfirm: canConfirmDictation,
      enableDuration: true,
    });

    const isRealtimeVoiceForCurrentAgent = computeIsRealtimeVoiceForAgent(
      voice,
      voiceServerId,
      voiceAgentId,
    );
    const showDictationOverlay = computeShouldShowDictationOverlay(
      isDictating,
      isDictationProcessing,
      dictationStatus,
    );
    const showRealtimeOverlay = isRealtimeVoiceForCurrentAgent;
    const showOverlay = showDictationOverlay || showRealtimeOverlay;
    const surfacePresentation = resolveComposerSurfacePresentation(showOverlay);

    useEffect(() => {
      if (isDictating || isDictationProcessing) {
        return;
      }
      sendAfterTranscriptRef.current = false;
    }, [dictationStatus, isDictating, isDictationProcessing]);

    const startDictationIfAvailable = useCallback(
      () =>
        startDictationIfAvailableImpl({
          dictationUnavailableMessage,
          canStartDictation,
          toast,
          startDictation,
          exitFullscreen,
        }),
      [canStartDictation, dictationUnavailableMessage, startDictation, toast, exitFullscreen],
    );

    const handleVoicePress = useCallback(
      () =>
        handleVoicePressImpl({
          isRealtimeVoiceForCurrentAgent,
          voice,
          isDictating,
          cancelDictation,
          startDictationIfAvailable,
        }),
      [
        cancelDictation,
        isDictating,
        isRealtimeVoiceForCurrentAgent,
        startDictationIfAvailable,
        voice,
      ],
    );

    const handleCancelRecording = useCallback(async () => {
      await cancelDictation();
    }, [cancelDictation]);

    const handleAcceptRecording = useCallback(async () => {
      sendAfterTranscriptRef.current = false;
      await confirmDictation();
    }, [confirmDictation]);

    const handleAcceptAndSendRecording = useCallback(async () => {
      sendAfterTranscriptRef.current = true;
      await confirmDictation();
    }, [confirmDictation]);

    const handleRetryFailedRecording = useCallback(() => {
      void retryFailedDictation();
    }, [retryFailedDictation]);

    const handleDiscardFailedRecording = useCallback(() => {
      discardFailedDictation();
    }, [discardFailedDictation]);

    const handleStopRealtimeVoice = useCallback(async () => {
      try {
        await stopRealtimeVoice({
          voice,
          isRealtimeVoiceForCurrentAgent,
          isAgentRunning,
          client,
          voiceAgentId,
        });
      } catch (error) {
        console.error("[MessageInput] Failed to stop realtime voice", error);
        const message = extractErrorMessage(error);
        if (message && message.trim().length > 0) {
          toast.error(message);
        }
      }
    }, [client, isAgentRunning, isRealtimeVoiceForCurrentAgent, toast, voice, voiceAgentId]);

    const handleToggleRealtimeVoiceShortcut = useCallback(() => {
      toggleRealtimeVoiceImpl({
        voice,
        voiceServerId,
        voiceAgentId,
        isConnected,
        disabled,
        isAgentRunning,
        handleStopRealtimeVoice,
        toast,
        interruptBeforeVoiceMessage: t("composer.voice.interruptBeforeVoice"),
        exitFullscreen,
      });
    }, [
      disabled,
      handleStopRealtimeVoice,
      exitFullscreen,
      isAgentRunning,
      isConnected,
      t,
      toast,
      voice,
      voiceAgentId,
      voiceServerId,
    ]);

    const handleSendMessage = useCallback(() => {
      const liveValue = textInputRef.current?.getText() ?? valueRef.current;
      if (!preserveHeightOnSubmit) {
        updateLiveTextPresence("");
      }
      sendMessageImpl({
        value: liveValue,
        attachments,
        hasExternalContent,
        allowEmptySubmit,
        cwd,
        isAgentRunning,
        onSubmit,
        exitFullscreen,
      });
    }, [
      allowEmptySubmit,
      attachments,
      cwd,
      onSubmit,
      isAgentRunning,
      hasExternalContent,
      preserveHeightOnSubmit,
      updateLiveTextPresence,
      exitFullscreen,
    ]);

    const handleQueueMessage = useCallback(
      () =>
        queueComposerInput({
          value: textInputRef.current?.getText() ?? valueRef.current,
          attachments,
          hasExternalContent,
          cwd,
          onQueue,
          replaceText,
          exitFullscreen,
        }),
      [attachments, cwd, hasExternalContent, onQueue, replaceText, exitFullscreen],
    );

    const handleDefaultSendAction = useCallback(() => {
      runDefaultSendAction({
        defaultSendBehavior,
        isAgentRunning,
        onQueue,
        handleSendMessage,
        handleQueueMessage,
      });
    }, [defaultSendBehavior, isAgentRunning, onQueue, handleQueueMessage, handleSendMessage]);

    const handleAlternateSendAction = useCallback(() => {
      runAlternateSendAction({
        defaultSendBehavior,
        isAgentRunning,
        onQueue,
        handleSendMessage,
        handleQueueMessage,
      });
    }, [defaultSendBehavior, isAgentRunning, handleSendMessage, handleQueueMessage, onQueue]);

    const getWebInputElement = useCallback(
      () => getTextInputNativeElement(textInputRef.current),
      [],
    );

    usePasteImagesEffect({
      getWebInputElement,
      isConnected,
      disabled,
      isDictating,
      isRealtimeVoiceForCurrentAgent,
      onAddImages,
    });

    const handleSelectionChange = useCallback(
      (event: NativeSyntheticEvent<ComposerSelectionChangeEventData>) => {
        const start = event.nativeEvent.selection?.start ?? 0;
        const end = event.nativeEvent.selection?.end ?? start;
        const blockBoundary = event.nativeEvent.blockBoundary ?? 0;
        selectionRef.current = { start, end, blockBoundary };
        onSelectionChangeCallback?.({ start, end, blockBoundary });
      },
      [onSelectionChangeCallback],
    );

    const shouldHandleWebKeyPress = isWeb;
    const shouldSubmitOnEnter = isWeb && !isCompact;

    const handleDesktopKeyPress = useCallback(
      (event: WebTextInputKeyPressEvent) => {
        if (!shouldHandleWebKeyPress) return;
        handleDesktopKeyPressImpl(event, {
          onKeyPressCallback,
          input: getComposerInputSnapshot(
            textInputRef.current,
            valueRef.current,
            selectionRef.current,
          ),
          submitOnEnter: shouldSubmitOnEnter,
          isAgentRunning,
          onQueue,
          isSubmitDisabled,
          isSubmitLoading,
          disabled,
          handleAlternateSendAction,
          handleDefaultSendAction,
        });
      },
      [
        shouldHandleWebKeyPress,
        onKeyPressCallback,
        shouldSubmitOnEnter,
        isAgentRunning,
        onQueue,
        isSubmitDisabled,
        isSubmitLoading,
        disabled,
        handleAlternateSendAction,
        handleDefaultSendAction,
      ],
    );

    const primaryActions = resolvePrimaryActions({
      hasSendableContent: hasSendableComposerContent({
        hasText: hasLiveText,
        attachments,
        hasExternalContent,
      }),
      allowEmptySubmit,
      isAgentRunning,
      isSubmitLoading,
    });
    const { canPressLoadingButton, isSendButtonDisabled, defaultActionQueues } =
      computeSendButtonState({
        disabled,
        isSubmitDisabled,
        isSubmitLoading,
        onSubmitLoadingPress,
        defaultSendBehavior,
        isAgentRunning,
      });
    useIosHardwareKeyboardSubmit({
      isEnabled: isInputFocused && !isSendButtonDisabled,
      onSubmit: handleDefaultSendAction,
    });
    const submitAccessibilityLabel = resolveSubmitAccessibilityLabel({
      submitButtonAccessibilityLabel,
      canPressLoadingButton,
      defaultActionQueues,
      defaultSendBehavior,
      isAgentRunning,
      t,
    });

    const voiceButtonAccessibilityLabel = resolveVoiceAccessibilityLabel({
      isRealtimeVoiceForCurrentAgent,
      isMuted: Boolean(voice?.isMuted),
      isDictating,
      t,
    });

    const voiceTooltipText = resolveVoiceTooltipText({
      isRealtimeVoiceForCurrentAgent,
      isMuted: Boolean(voice?.isMuted),
      t,
    });

    const sendTooltipLabel = resolveSendTooltipLabel({
      submitButtonAccessibilityLabel,
      defaultActionQueues,
      t,
    });

    const handleInputChange = useCallback(
      (nextValue: string) => {
        valueRef.current = nextValue;
        updateLiveTextPresence(nextValue);
        onChangeText(nextValue, textInputRef.current?.getSegments?.());
      },
      [onChangeText, updateLiveTextPresence],
    );

    const handleInputFocus = useCallback(() => {
      focusIntentRef.current = true;
      isInputFocusedRef.current = true;
      setIsInputFocused(true);
      onFocusChange?.(true);
    }, [onFocusChange]);

    const handleInputBlur = useCallback(() => {
      // A blur in the active pane is a dismissal; only hiding the pane preserves intent.
      if (paneFocusedRef.current) focusIntentRef.current = false;
      isInputFocusedRef.current = false;
      setIsInputFocused(false);
      onFocusChange?.(false);
    }, [onFocusChange]);

    const handlePasteError = useCallback(
      (message: string) => {
        console.error("[MessageInput] Native paste failed:", message);
        toast.error(t("composer.errors.pasteImageFailed"));
      },
      [t, toast],
    );

    const attachButtonStyle = useCallback(
      ({ hovered }: { hovered?: boolean }) => [
        styles.attachButton,
        Boolean(hovered) && styles.iconButtonHovered,
        (!isConnected || disabled) && styles.buttonDisabled,
      ],
      [isConnected, disabled],
    );

    const voiceButtonStyle = useCallback(
      ({ hovered }: { hovered?: boolean }) => [
        styles.voiceButton,
        Boolean(hovered) && !isDictating && styles.iconButtonHovered,
        !isDictationStartEnabled && styles.buttonDisabled,
        isDictating && styles.voiceButtonRecording,
      ],
      [isDictating, isDictationStartEnabled],
    );

    const handleRealtimeVoiceStop = useCallback(() => {
      void handleStopRealtimeVoice();
    }, [handleStopRealtimeVoice]);

    const inputWrapperCombinedStyle = useMemo(
      () => [
        styles.inputWrapper,
        readOnly && styles.inputWrapperReadOnly,
        inputWrapperStyle,
        { opacity: surfacePresentation.input.opacity },
      ],
      [inputWrapperStyle, readOnly, surfacePresentation.input.opacity],
    );
    // `withUnistyles` maps this component's `style` into a `.hash > *` child
    // rule, which ties on specificity with react-native-web's own
    // `.css-textinput-*` class and loses on source order — so a themed
    // `fontFamily` here is silently dropped while every other property lands.
    // An inline style outranks both classes. See docs/unistyles.md.
    const textInputStyle = useMemo(
      () => [
        styles.textInput,
        mode.isMonospace && styles.textInputMonospace,
        isFullscreen ? styles.fullscreenTextInput : composerHeightStyle,
        isCompact && !isFullscreen && styles.compactTextInput,
      ],
      [composerHeightStyle, mode.isMonospace, isFullscreen, isCompact],
    );
    // Static content has no textarea to mirror, so it grows with its own text
    // instead of the measured input height.
    const readOnlyTextStyle = useMemo(
      () => [styles.textInput, mode.isMonospace && styles.textInputMonospace, styles.readOnlyText],
      [mode.isMonospace],
    );
    // Fullscreen always shows Send; without content it is disabled, and looks it.
    const isPresentedSendDisabled = resolvePresentationSendDisabled({
      fullscreen: isFullscreen,
      disabled: isSendButtonDisabled,
      hasText: hasLiveText,
      attachments,
      hasExternalContent,
      allowEmpty: allowEmptySubmit,
    });
    const sendButtonCombinedStyle = useMemo(
      () => [
        styles.sendButton,
        submitLabel ? styles.sendButtonLabeled : undefined,
        isPresentedSendDisabled && styles.buttonDisabled,
      ],
      [isPresentedSendDisabled, submitLabel],
    );
    const overlayContainerStyle = useMemo(
      () => [styles.overlayContainer, { opacity: surfacePresentation.overlay.opacity }],
      [surfacePresentation.overlay.opacity],
    );

    const renderAttachButtonIcon = useCallback(
      ({ hovered }: { hovered?: boolean }) => (
        <AttachButtonIcon
          hovered={Boolean(hovered)}
          onAttachButtonRef={onAttachButtonRef}
          buttonIconSize={buttonIconSize}
        />
      ),
      [onAttachButtonRef, buttonIconSize],
    );

    const renderVoiceButtonIcon = useCallback(
      ({ hovered }: { hovered?: boolean }) => (
        <VoiceButtonIcon
          hovered={Boolean(hovered)}
          isDictating={isDictating}
          isMutedRealtime={Boolean(isRealtimeVoiceForCurrentAgent && voice?.isMuted)}
          buttonIconSize={buttonIconSize}
        />
      ),
      [isDictating, isRealtimeVoiceForCurrentAgent, voice?.isMuted, buttonIconSize],
    );

    const sendButton = useMemo(
      () => (
        <SendButtonTooltip
          shouldShow={isFullscreen || primaryActions.showSend}
          canPressLoadingButton={canPressLoadingButton}
          onSubmitLoadingPress={onSubmitLoadingPress}
          onDefaultSendAction={handleDefaultSendAction}
          isSendButtonDisabled={isPresentedSendDisabled}
          submitAccessibilityLabel={submitAccessibilityLabel}
          sendButtonCombinedStyle={sendButtonCombinedStyle}
          isSubmitLoading={isSubmitLoading}
          submitIcon={submitIcon}
          submitLabel={submitLabel}
          submitButtonTestID={submitButtonTestID}
          buttonIconSize={buttonIconSize}
          sendKeys={DEFAULT_SEND_KEYS}
          sendTooltipLabel={sendTooltipLabel}
        />
      ),
      [
        isFullscreen,
        primaryActions.showSend,
        canPressLoadingButton,
        onSubmitLoadingPress,
        handleDefaultSendAction,
        isPresentedSendDisabled,
        submitAccessibilityLabel,
        sendButtonCombinedStyle,
        isSubmitLoading,
        submitIcon,
        submitLabel,
        submitButtonTestID,
        buttonIconSize,
        sendTooltipLabel,
      ],
    );
    const textSurface = useMemo(
      () => (
        <RenderProfile id="ComposerTextSurface">
          <ComposerTextSurface
            readOnly={readOnly}
            value={
              readOnly
                ? value
                : resolveComposerSurfaceText(
                    valueRef.current,
                    textReplacement,
                    appliedTextReplacementKeyRef.current,
                  )
            }
            valueSegments={valueSegments}
            serverId={serverId}
            textInputRef={assignTextInput}
            textInputStyle={textInputStyle}
            readOnlyTextStyle={readOnlyTextStyle}
            placeholder={placeholder ?? t("composer.placeholders.fallback")}
            accessibilityLabel={t(mode.accessibilityLabelKey)}
            onChangeText={handleInputChange}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            editable={!isDictating && !isRealtimeVoiceForCurrentAgent && !disabled}
            autoFocus={false}
            onKeyPress={shouldHandleWebKeyPress ? handleDesktopKeyPress : undefined}
            onSelectionChange={handleSelectionChange}
            onPasteImages={onPasteImages}
            onPasteError={handlePasteError}
            textReplacementKey={textReplacement.key}
            fullscreen={isFullscreen}
            compact={isCompact}
            onRenderedLinesChange={setRenderedLines}
            focusHintVisible={!isFullscreen && isWeb && !isInputFocused && !value}
            focusInputKeys={focusInputKeys}
            focusHintLabel={t("composer.input.focusHint", {
              shortcut: focusInputKeys ? formatShortcut(focusInputKeys[0], getShortcutOs()) : "",
            })}
          />
        </RenderProfile>
      ),
      [
        readOnly,
        value,
        textReplacement,
        valueSegments,
        serverId,
        assignTextInput,
        textInputStyle,
        readOnlyTextStyle,
        placeholder,
        t,
        mode.accessibilityLabelKey,
        handleInputChange,
        handleInputFocus,
        handleInputBlur,
        isDictating,
        isRealtimeVoiceForCurrentAgent,
        disabled,
        shouldHandleWebKeyPress,
        handleDesktopKeyPress,
        handleSelectionChange,
        onPasteImages,
        handlePasteError,
        isFullscreen,
        isCompact,
        isInputFocused,
        focusInputKeys,
      ],
    );
    const toolbar = useMemo(
      () => (
        <View style={styles.buttonRow}>
          {/* 左侧只放 agent controls，窄 pane 时由它们截断 */}
          <View style={styles.leftButtonGroup}>{leftContent}</View>

          {/* 右侧不参与压缩：附件、上下文占用、语音、停止与发送 */}
          <View style={styles.rightButtonGroup}>
            <AttachmentDropdown
              visible={mode.showAttachments}
              isConnected={isConnected}
              disabled={disabled}
              attachButtonStyle={attachButtonStyle}
              renderAttachButtonIcon={renderAttachButtonIcon}
              attachmentMenuItems={attachmentMenuItems}
              addAttachmentLabel={t("composer.input.addAttachment")}
            />
            {beforeVoiceContent}
            <VoiceButtonTooltip
              visible={mode.showVoice}
              onVoicePress={handleVoicePress}
              isDictationStartEnabled={isDictationStartEnabled}
              voiceButtonAccessibilityLabel={voiceButtonAccessibilityLabel}
              voiceButtonStyle={voiceButtonStyle}
              renderVoiceButtonIcon={renderVoiceButtonIcon}
              voiceTooltipText={voiceTooltipText}
              isRealtimeVoiceForCurrentAgent={isRealtimeVoiceForCurrentAgent}
              voiceMuteToggleKeys={voiceMuteToggleKeys}
              dictationToggleKeys={dictationToggleKeys}
            />
            {rightContent}
            {resolveStopAction(primaryActions, activeActionContent)}
            {sendButton}
          </View>
        </View>
      ),
      [
        leftContent,
        mode.showAttachments,
        isConnected,
        disabled,
        attachButtonStyle,
        renderAttachButtonIcon,
        attachmentMenuItems,
        t,
        beforeVoiceContent,
        mode.showVoice,
        handleVoicePress,
        isDictationStartEnabled,
        voiceButtonAccessibilityLabel,
        voiceButtonStyle,
        renderVoiceButtonIcon,
        voiceTooltipText,
        isRealtimeVoiceForCurrentAgent,
        voiceMuteToggleKeys,
        dictationToggleKeys,
        rightContent,
        primaryActions,
        activeActionContent,
        sendButton,
      ],
    );
    const voiceOverlay = useMemo(
      () => (
        <View
          style={overlayContainerStyle}
          pointerEvents={surfacePresentation.overlay.pointerEvents}
        >
          <MessageInputOverlay
            showDictationOverlay={showDictationOverlay}
            showRealtimeOverlay={showRealtimeOverlay}
            voice={voice}
            dictationVolume={dictationVolume}
            dictationDuration={dictationDuration}
            isDictating={isDictating}
            isDictationProcessing={isDictationProcessing}
            dictationStatus={dictationStatus}
            dictationError={dictationError}
            onCancelRecording={handleCancelRecording}
            onAcceptRecording={handleAcceptRecording}
            onAcceptAndSendRecording={handleAcceptAndSendRecording}
            onRetryFailedRecording={handleRetryFailedRecording}
            onDiscardFailedRecording={handleDiscardFailedRecording}
            onRealtimeVoiceStop={handleRealtimeVoiceStop}
          />
        </View>
      ),
      [
        overlayContainerStyle,
        surfacePresentation.overlay.pointerEvents,
        showDictationOverlay,
        showRealtimeOverlay,
        voice,
        dictationVolume,
        dictationDuration,
        isDictating,
        isDictationProcessing,
        dictationStatus,
        dictationError,
        handleCancelRecording,
        handleAcceptRecording,
        handleAcceptAndSendRecording,
        handleRetryFailedRecording,
        handleDiscardFailedRecording,
        handleRealtimeVoiceStop,
      ],
    );

    return (
      <View
        ref={rootRef}
        style={isFullscreen ? styles.fullscreenContainer : styles.container}
        testID="message-input-root"
        onLayout={handleComposerLayout}
      >
        <MessageInputAutoFocus
          enabled={autoFocus}
          autoFocusKey={autoFocusKey}
          textInputRef={textInputRef}
        />
        <ComposerInputPresentation
          fullscreen={isFullscreen}
          sendIconSize={buttonIconSize}
          surface={textSurface}
          toolbar={toolbar}
          send={sendButton}
          error={props.submissionError}
          onExit={exitFullscreen}
          inputWrapperRef={inputWrapperRef}
          inputWrapperStyle={inputWrapperCombinedStyle}
          inputPointerEvents={surfacePresentation.input.pointerEvents}
          attachmentSlot={attachmentSlot}
          showFullscreenButton={shouldShowFullscreenControl(
            isCompact,
            readOnly,
            showOverlay,
            renderedLines,
          )}
          onEnter={enterFullscreen}
          overlay={voiceOverlay}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flexShrink: 1,
    position: "relative",
  },
  fullscreenContainer: {
    flex: 1,
    position: "relative",
  },
  // 全屏按钮所在的那一条是输入框自己的内边距，点在那里就是点在输入框上；
  // 按钮出现与否都预留，文字不会在它出现时重排。
  compactTextInput: { paddingRight: 36 },
  fullscreenTextSurface: { flex: 1, minHeight: 0 },
  fullscreenTextInput: { flex: 1, height: "100%", textAlignVertical: "top" },
  lineMeasurement: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
    maxHeight: undefined,
    minHeight: undefined,
    height: undefined,
  },
  inputWrapper: {
    flexShrink: 1,
    flexDirection: "column",
    gap: theme.spacing[3],
    ...composerSurfaceStyle(theme, { glass: GLASS_SURFACES_ENABLED }),
    paddingTop: {
      xs: theme.spacing[2],
      md: theme.spacing[3],
    },
    paddingBottom: theme.spacing[2],
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    ...(isWeb
      ? {
          transitionProperty: "border-color",
          transitionDuration: "200ms",
          transitionTimingFunction: "ease-in-out",
        }
      : {}),
  },
  // Dotted says "this surface is the same box, but there is nothing to type
  // into it" without swapping the border colour, which reads as an error state.
  inputWrapperReadOnly: {
    borderStyle: "dotted",
  },
  textInputScrollWrapper: {
    flexShrink: 1,
    position: "relative",
  },
  focusHintText: {
    position: "absolute",
    top: 0,
    right: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    opacity: 0.5,
  },
  textInput: {
    // Preserve the controls when an ancestor constrains an overlong draft.
    flexShrink: 1,
    width: "100%",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.content,
    fontWeight: theme.fontWeight.normal,
    // No lineHeight on native. React Native applies it as a span over the text, and an
    // empty trailing line is laid out from the font's own metrics on some devices, so
    // the input jumps when the first character lands on a new line. The font's natural
    // line box is the same for every line. Web keeps the CSS value.
    ...(isWeb
      ? ({
          lineHeight: theme.fontSize.content * 1.4,
          outlineStyle: "none",
          outlineWidth: 0,
          outlineColor: "transparent",
        } as object)
      : {}),
  },
  textInputMonospace: {
    fontFamily: theme.fontFamily.mono,
  },
  readOnlyText: {
    minHeight: MIN_INPUT_HEIGHT,
    color: theme.colors.foregroundMuted,
  },
  // 窄 pane 时只有左组（agent controls）让出宽度并被裁掉，右组的停止与发送保持原宽。
  buttonRow: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[1],
    marginHorizontal: -theme.spacing[1.5],
  },
  leftButtonGroup: {
    minWidth: 0,
    flexShrink: 1,
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  rightButtonGroup: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  attachButton: {
    width: theme.controlHeight.md,
    height: theme.controlHeight.md,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  attachButtonAnchor: {
    width: theme.controlHeight.md,
    height: theme.controlHeight.md,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceButton: {
    width: theme.controlHeight.md,
    height: theme.controlHeight.md,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceButtonRecording: {
    backgroundColor: theme.colors.destructive,
  },
  sendButton: {
    width: theme.controlHeight.lg,
    height: theme.controlHeight.lg,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonLabeled: {
    width: "auto",
    minWidth: theme.controlHeight.lg,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.radius.full,
  },
  sendButtonLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.accentForeground,
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  overlayContainer: {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    right: 0,
    bottom: 0,
  },
})) as unknown as Record<string, object>;

const ThemedPlus = withUnistyles(Plus);
const ThemedMic = withUnistyles(Mic);
const ThemedMicOff = withUnistyles(MicOff);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedCornerDownLeft = withUnistyles(CornerDownLeft);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconAccentForegroundMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
