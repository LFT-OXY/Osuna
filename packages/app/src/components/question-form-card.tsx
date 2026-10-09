import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useState, useCallback, useMemo, type ReactNode } from "react";
import { View, Pressable, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ArrowRight, Check, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { PendingPermission } from "@/types/shared";
import type { AgentPermissionResponse } from "@osuna/protocol/agent-types";
import { isNative } from "@/constants/platform";
import { Button } from "@/components/ui/button";
import {
  createControlGeometry,
  resolveControlInteractionStyles,
} from "@/components/ui/control-geometry";
import { FormTextInput } from "@/components/ui/form-field";
import { Text } from "@/components/ui/text";
import { EditingTextInput } from "@/components/ui/text-input";
import { ICON_SIZE } from "@/styles/theme";
import {
  buildQuestionFormAnswers,
  canConfirmQuestion,
  EMPTY_QUESTION_FORM_STATE,
  isOtherInputExpanded,
  markQuestionAnswered,
  parseQuestionFormQuestions,
  pickQuestionOption,
  resolveNextQuestionFormStep,
  resolvePrimaryActionKind,
  resolveSkipLabel,
  setQuestionOtherText,
  shouldSubmitEmptyOnDismiss,
  skipQuestion,
  type QuestionFormQuestion,
  type QuestionFormState,
  type QuestionOption,
} from "./question-form-card-core";

interface QuestionFormCardProps {
  permission: PendingPermission;
  onRespond: (response: AgentPermissionResponse) => void;
  isResponding: boolean;
}

/** 哪个控件触发了这次发送，加载指示就画在哪里。 */
type RespondingSource =
  | { kind: "option"; optIndex: number }
  | { kind: "primary" }
  | { kind: "skip" }
  | { kind: "dismiss" };

type HoverableState = PressableStateCallbackType & { hovered?: boolean };

const ThemedArrowRight = withUnistyles(ArrowRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedCheck = withUnistyles(Check, (theme) => ({
  color: theme.colors.accentForeground,
}));
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedTextInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

function NumberBadge({ number, isSelected }: { number: number; isSelected: boolean }) {
  return (
    <View style={[styles.numberBadge, isSelected ? styles.numberBadgeSelected : null]}>
      {isSelected ? (
        <ThemedCheck size={ICON_SIZE.sm} />
      ) : (
        <Text variant="caption" color="foregroundMuted">
          {number}
        </Text>
      )}
    </View>
  );
}

interface RowTrailingProps {
  isHovered: boolean;
  isLoading: boolean;
  showArrow: boolean;
}

// 箭头和加载指示共用一个固定宽度的尾槽，悬停和发送都不会让行内容移动。
function RowTrailing({ isHovered, isLoading, showArrow }: RowTrailingProps) {
  if (isLoading) {
    return (
      <View style={styles.rowTrailing}>
        <ThemedLoadingSpinner size="small" />
      </View>
    );
  }
  return (
    <View style={[styles.rowTrailing, showArrow && isHovered ? null : styles.hidden]}>
      <ThemedArrowRight size={ICON_SIZE.md} />
    </View>
  );
}

interface QuestionOptionRowProps {
  optIndex: number;
  option: QuestionOption;
  isSelected: boolean;
  multiSelect: boolean;
  showArrow: boolean;
  isLoading: boolean;
  isResponding: boolean;
  onPick: (optIndex: number) => void;
}

function QuestionOptionRow({
  optIndex,
  option,
  isSelected,
  multiSelect,
  showArrow,
  isLoading,
  isResponding,
  onPick,
}: QuestionOptionRowProps) {
  const handlePress = useCallback(() => {
    onPick(optIndex);
  }, [onPick, optIndex]);
  const accessibilityState = useMemo(
    () => ({ checked: isSelected, disabled: isResponding }),
    [isSelected, isResponding],
  );
  const pressableStyle = useCallback(
    ({ pressed, hovered }: HoverableState) => [
      styles.row,
      hovered || pressed ? styles.rowHighlighted : null,
      isResponding && !isLoading ? styles.disabled : null,
    ],
    [isResponding, isLoading],
  );
  const renderContent = useCallback(
    ({ hovered }: HoverableState) => (
      <>
        <NumberBadge number={optIndex + 1} isSelected={isSelected} />
        <View style={styles.rowText}>
          <Text>{option.label}</Text>
          {option.description ? <Text color="foregroundMuted">{option.description}</Text> : null}
        </View>
        {/* → 表示点下去就作答：多选行和"其他..."行点下去只是切换或展开，不显示。 */}
        {multiSelect ? null : (
          <RowTrailing isHovered={Boolean(hovered)} isLoading={isLoading} showArrow={showArrow} />
        )}
      </>
    ),
    [isLoading, isSelected, multiSelect, option.description, option.label, optIndex, showArrow],
  );

  return (
    <Pressable
      style={pressableStyle}
      onPress={handlePress}
      disabled={isResponding}
      accessibilityRole={multiSelect ? "checkbox" : "radio"}
      accessibilityLabel={option.label}
      accessibilityState={accessibilityState}
      aria-checked={isSelected}
    >
      {renderContent}
    </Pressable>
  );
}

interface QuestionOtherRowProps {
  number: number;
  label: string;
  isResponding: boolean;
  onExpand: () => void;
}

function QuestionOtherRow({ number, label, isResponding, onExpand }: QuestionOtherRowProps) {
  const pressableStyle = useCallback(
    ({ pressed, hovered }: HoverableState) => [
      styles.row,
      hovered || pressed ? styles.rowHighlighted : null,
      isResponding ? styles.disabled : null,
    ],
    [isResponding],
  );

  return (
    <Pressable
      style={pressableStyle}
      onPress={onExpand}
      disabled={isResponding}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="question-form-other-option"
    >
      <NumberBadge number={number} isSelected={false} />
      <View style={styles.rowText}>
        <Text>{label}</Text>
      </View>
    </Pressable>
  );
}

interface QuestionOtherInputRowProps {
  number: number;
  accessibilityLabel: string;
  initialValue: string;
  placeholder: string;
  isResponding: boolean;
  onChange: (text: string) => void;
  onSubmit: () => void;
}

// 框内要保留编号圆圈，FormTextInput 放不下，所以自绘外框，四态样式与它共用 control-geometry。
// 外框不是按压目标，悬停用普通 View 的 pointer 事件，免得在 Web 上多一个 Tab 停留点。
function QuestionOtherInputRow({
  number,
  accessibilityLabel,
  initialValue,
  placeholder,
  isResponding,
  onChange,
  onSubmit,
}: QuestionOtherInputRowProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  return (
    <View
      style={styles.hoverEnvelope}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <View
        style={[
          styles.row,
          styles.otherInputFrame,
          resolveControlInteractionStyles(
            {
              controlRest: styles.controlRest,
              controlHover: styles.controlHover,
              controlActive: styles.controlActive,
              controlDisabled: styles.controlDisabled,
            },
            { hovered: isHovered, focused: isFocused, disabled: isResponding },
          ),
        ]}
      >
        <NumberBadge number={number} isSelected={false} />
        <ThemedTextInput
          style={styles.otherInput}
          accessibilityLabel={accessibilityLabel}
          placeholder={placeholder}
          initialValue={initialValue}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          onFocus={handleFocus}
          onBlur={handleBlur}
          editable={!isResponding}
          autoFocus
          blurOnSubmit={false}
        />
      </View>
    </View>
  );
}

interface QuestionOptionListProps {
  question: QuestionFormQuestion;
  selected: ReadonlySet<number> | undefined;
  otherText: string;
  otherLabel: string;
  isOtherExpanded: boolean;
  showArrow: boolean;
  loadingSource: RespondingSource | null;
  isResponding: boolean;
  onPick: (optIndex: number) => void;
  onExpandOther: () => void;
  onOtherTextChange: (text: string) => void;
  onConfirm: () => void;
}

function QuestionOptionList({
  question,
  selected,
  otherText,
  otherLabel,
  isOtherExpanded,
  showArrow,
  loadingSource,
  isResponding,
  onPick,
  onExpandOther,
  onOtherTextChange,
  onConfirm,
}: QuestionOptionListProps) {
  const otherNumber = question.options.length + 1;
  const loadingOptIndex = loadingSource?.kind === "option" ? loadingSource.optIndex : null;
  let otherRow: ReactNode = null;
  if (isOtherExpanded) {
    otherRow = (
      <QuestionOtherInputRow
        number={otherNumber}
        accessibilityLabel={question.question}
        initialValue={otherText}
        placeholder={otherLabel}
        isResponding={isResponding}
        onChange={onOtherTextChange}
        onSubmit={onConfirm}
      />
    );
  } else if (question.allowOther) {
    otherRow = (
      <QuestionOtherRow
        number={otherNumber}
        label={otherLabel}
        isResponding={isResponding}
        onExpand={onExpandOther}
      />
    );
  }

  return (
    <View
      style={styles.options}
      accessibilityRole={question.multiSelect ? undefined : "radiogroup"}
      accessibilityLabel={question.multiSelect ? undefined : question.question}
    >
      {question.options.map((option, optIndex) => (
        <QuestionOptionRow
          key={option.label}
          optIndex={optIndex}
          option={option}
          isSelected={selected?.has(optIndex) ?? false}
          multiSelect={question.multiSelect}
          showArrow={showArrow}
          isLoading={loadingOptIndex === optIndex}
          isResponding={isResponding}
          onPick={onPick}
        />
      ))}
      {otherRow}
    </View>
  );
}

interface QuestionNavButtonProps {
  index: number;
  total: number;
  header: string;
  isActive: boolean;
  isAnswered: boolean;
  isResponding: boolean;
  onSelect: (index: number) => void;
}

function QuestionNavButton({
  index,
  total,
  header,
  isActive,
  isAnswered,
  isResponding,
  onSelect,
}: QuestionNavButtonProps) {
  const accessibilityState = useMemo(() => ({ selected: isActive }), [isActive]);
  const handlePress = useCallback(() => {
    onSelect(index);
  }, [index, onSelect]);

  return (
    <Button
      variant="ghost"
      size="xs"
      leftIcon={isAnswered ? Check : null}
      onPress={handlePress}
      disabled={isResponding}
      accessibilityRole="tab"
      accessibilityLabel={`Question ${index + 1} of ${total}`}
      accessibilityState={accessibilityState}
      aria-selected={isActive}
      testID={`question-form-question-nav-${index + 1}`}
      style={isActive ? styles.navTabActive : null}
      textStyle={isActive ? styles.navTabTextActive : null}
    >
      {header}
    </Button>
  );
}

interface QuestionNavProps {
  questions: QuestionFormQuestion[];
  activeIndex: number;
  formState: QuestionFormState;
  isResponding: boolean;
  onSelect: (index: number) => void;
}

// 每道题一个标签页，已作答的带勾。只有一道题时不显示，「1 of 1」没有信息量。
function QuestionNav({
  questions,
  activeIndex,
  formState,
  isResponding,
  onSelect,
}: QuestionNavProps) {
  if (questions.length <= 1) {
    return null;
  }
  return (
    <View style={styles.nav} testID="question-form-question-nav" accessibilityRole="tablist">
      {questions.map((question, qIndex) => (
        <QuestionNavButton
          key={question.header}
          index={qIndex}
          total={questions.length}
          header={question.header}
          isActive={qIndex === activeIndex}
          isAnswered={formState.statuses[qIndex] === "answered"}
          isResponding={isResponding}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

interface QuestionFormFooterProps {
  skipLabel: string;
  /** 为 null 时不显示「下一步/提交」：单选题点选项即作答。 */
  primaryActionLabel: string | null;
  canConfirm: boolean;
  isResponding: boolean;
  loadingKind: RespondingSource["kind"] | null;
  onSkip: () => void;
  onConfirm: () => void;
}

function QuestionFormFooter({
  skipLabel,
  primaryActionLabel,
  canConfirm,
  isResponding,
  loadingKind,
  onSkip,
  onConfirm,
}: QuestionFormFooterProps) {
  return (
    <View style={styles.footer}>
      <Button
        variant="outline"
        size="sm"
        onPress={onSkip}
        disabled={isResponding}
        loading={loadingKind === "skip"}
        testID="question-form-skip"
      >
        {skipLabel}
      </Button>
      {primaryActionLabel ? (
        <Button
          variant="default"
          size="sm"
          onPress={onConfirm}
          disabled={isResponding || !canConfirm}
          loading={loadingKind === "primary"}
          accessibilityLabel={primaryActionLabel}
          testID="question-form-primary-action"
        >
          {primaryActionLabel}
        </Button>
      ) : null}
    </View>
  );
}

export function QuestionFormCard({ permission, onRespond, isResponding }: QuestionFormCardProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const questions = useMemo(
    () => parseQuestionFormQuestions(permission.request.input),
    [permission.request.input],
  );

  const [formState, setFormState] = useState<QuestionFormState>(EMPTY_QUESTION_FORM_STATE);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [expandedOtherQuestions, setExpandedOtherQuestions] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [respondingSource, setRespondingSource] = useState<RespondingSource | null>(null);

  const activeIndex = questions ? Math.min(activeQuestionIndex, questions.length - 1) : 0;
  const activeQuestion = questions?.[activeIndex];
  const activeOtherText = formState.otherTexts[activeIndex] ?? "";
  const isOtherExpanded = isOtherInputExpanded(
    activeQuestion,
    expandedOtherQuestions.has(activeIndex),
    activeOtherText,
  );

  const respondWithAnswers = useCallback(
    (answers: Record<string, string>) => {
      onRespond({ behavior: "allow", updatedInput: { ...permission.request.input, answers } });
    },
    [onRespond, permission.request.input],
  );

  // 忽略整组时不带上已输入的内容，X 和单题的「跳过」才会是同一个结果。
  const respondDismiss = useCallback(() => {
    if (!questions) return;
    if (shouldSubmitEmptyOnDismiss(questions)) {
      respondWithAnswers(buildQuestionFormAnswers(questions, {}, {}));
      return;
    }
    onRespond({ behavior: "deny", message: "Dismissed by user" });
  }, [questions, respondWithAnswers, onRespond]);

  // 当前题处理完：跳到下一道未处理的题，或者结束整组。
  const advance = useCallback(
    (next: QuestionFormState, source: RespondingSource) => {
      if (!questions || isResponding) return;
      setFormState(next);
      const step = resolveNextQuestionFormStep(questions, activeIndex, next);
      if (step.kind === "show") {
        setActiveQuestionIndex(step.index);
        return;
      }
      setRespondingSource(source);
      if (step.kind === "submit") {
        respondWithAnswers(step.answers);
        return;
      }
      respondDismiss();
    },
    [questions, isResponding, activeIndex, respondWithAnswers, respondDismiss],
  );

  const collapseOther = useCallback((qIndex: number) => {
    setExpandedOtherQuestions((prev) => {
      if (!prev.has(qIndex)) return prev;
      const next = new Set(prev);
      next.delete(qIndex);
      return next;
    });
  }, []);

  const handlePickOption = useCallback(
    (optIndex: number) => {
      if (!questions || !activeQuestion || isResponding) return;
      collapseOther(activeIndex);
      const next = pickQuestionOption(formState, questions, activeIndex, optIndex);
      if (activeQuestion.multiSelect) {
        setFormState(next);
        return;
      }
      advance(next, { kind: "option", optIndex });
    },
    [questions, activeQuestion, isResponding, collapseOther, activeIndex, formState, advance],
  );

  const handleExpandOther = useCallback(() => {
    setExpandedOtherQuestions((prev) => new Set(prev).add(activeIndex));
  }, [activeIndex]);

  const handleActiveTextChange = useCallback(
    (text: string) => {
      setFormState((prev) => setQuestionOtherText(prev, activeIndex, text));
    },
    [activeIndex],
  );

  const canConfirm =
    questions !== null && canConfirmQuestion(questions, activeIndex, formState, isOtherExpanded);

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    advance(markQuestionAnswered(formState, activeIndex), { kind: "primary" });
  }, [canConfirm, advance, formState, activeIndex]);

  const handleSkip = useCallback(() => {
    collapseOther(activeIndex);
    advance(skipQuestion(formState, activeIndex), { kind: "skip" });
  }, [collapseOther, activeIndex, advance, formState]);

  const handleDismiss = useCallback(() => {
    if (isResponding) return;
    setRespondingSource({ kind: "dismiss" });
    respondDismiss();
  }, [isResponding, respondDismiss]);

  const handleSelectQuestion = useCallback((index: number) => {
    setActiveQuestionIndex(index);
  }, []);

  if (!questions || !activeQuestion) {
    return null;
  }

  const loadingSource = isResponding ? respondingSource : null;
  const isTextOnly = activeQuestion.options.length === 0;
  const showPrimaryAction = activeQuestion.multiSelect || isTextOnly || isOtherExpanded;
  const primaryActionLabel =
    resolvePrimaryActionKind(questions.length, activeIndex, formState.statuses) === "next"
      ? t("message.question.next")
      : t("message.question.submit");

  return (
    <View style={styles.container} testID="question-form-card">
      <View style={styles.header}>
        <View style={styles.headerMain}>
          <QuestionNav
            questions={questions}
            activeIndex={activeIndex}
            formState={formState}
            isResponding={isResponding}
            onSelect={handleSelectQuestion}
          />
          <Text testID="question-form-current-question" style={styles.headerText}>
            {activeQuestion.question}
          </Text>
        </View>
        <Button
          variant="ghost"
          size="xs"
          leftIcon={X}
          onPress={handleDismiss}
          disabled={isResponding}
          loading={loadingSource?.kind === "dismiss"}
          accessibilityLabel={t("common.actions.dismiss")}
          testID="question-form-dismiss"
        />
      </View>

      <View key={activeIndex} style={styles.body}>
        {isTextOnly ? (
          <View style={styles.answerField}>
            <FormTextInput
              accessibilityLabel={activeQuestion.question}
              placeholder={activeQuestion.placeholder ?? t("message.question.answerPlaceholder")}
              initialValue={activeOtherText}
              onChangeText={handleActiveTextChange}
              onSubmitEditing={handleConfirm}
              editable={!isResponding}
              blurOnSubmit={false}
            />
          </View>
        ) : (
          <QuestionOptionList
            question={activeQuestion}
            selected={formState.selections[activeIndex]}
            otherText={activeOtherText}
            otherLabel={activeQuestion.placeholder ?? t("message.question.otherPlaceholder")}
            isOtherExpanded={isOtherExpanded}
            showArrow={!isNative && !isCompact}
            loadingSource={loadingSource}
            isResponding={isResponding}
            onPick={handlePickOption}
            onExpandOther={handleExpandOther}
            onOtherTextChange={handleActiveTextChange}
            onConfirm={handleConfirm}
          />
        )}
      </View>

      <QuestionFormFooter
        skipLabel={resolveSkipLabel(questions, t("message.question.skip"))}
        primaryActionLabel={showPrimaryAction ? primaryActionLabel : null}
        canConfirm={canConfirm}
        isResponding={isResponding}
        loadingKind={loadingSource?.kind ?? null}
        onSkip={handleSkip}
        onConfirm={handleConfirm}
      />
    </View>
  );
}

const NUMBER_BADGE_SIZE = 24;

const styles = StyleSheet.create((theme) => ({
  container: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceCard,
  },
  nav: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  navTabActive: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  navTabTextActive: {
    color: theme.colors.foreground,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  headerMain: {
    flex: 1,
    gap: theme.spacing[3],
  },
  headerText: {
    paddingTop: theme.spacing[0.5],
  },
  body: {
    // 行的悬停底色比内容多出一圈，向外借回这圈留白，让编号圆圈和问题文字对齐。
    marginHorizontal: -theme.spacing[2],
  },
  options: {
    gap: theme.spacing[0.5],
  },
  row: {
    flexDirection: "row",
    // 圆圈对齐选项名这一行，说明换行多了也不下沉到中间。
    alignItems: "flex-start",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: "transparent",
  },
  rowHighlighted: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  hoverEnvelope: {
    position: "relative",
  },
  otherInputFrame: {
    alignItems: "center",
    backgroundColor: theme.colors.surface2,
  },
  // 带颜色的条目直接引用 theme 才会被记为主题依赖，所以逐条展开（同 form-field.tsx）。
  controlRest: {
    ...createControlGeometry(theme).controlRest,
  },
  controlHover: {
    ...createControlGeometry(theme).controlHover,
  },
  controlActive: {
    ...createControlGeometry(theme).controlActive,
  },
  controlDisabled: {
    ...createControlGeometry(theme).controlDisabled,
  },
  rowText: {
    flex: 1,
    gap: theme.spacing[0.5],
    // 文字第一行与圆圈居中对齐；行高随界面字号缩放，所以按差值算。
    paddingTop: Math.max(0, (NUMBER_BADGE_SIZE - theme.typeScale.body.lineHeight) / 2),
  },
  rowTrailing: {
    width: theme.iconSize.md,
    height: NUMBER_BADGE_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  hidden: {
    opacity: 0,
  },
  disabled: {
    opacity: theme.opacity[50],
  },
  numberBadge: {
    width: NUMBER_BADGE_SIZE,
    height: NUMBER_BADGE_SIZE,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    // 半透明填充在亮暗两种卡片上都能看出来；暗色主题的卡片本身就是 surface2。
    backgroundColor: theme.colors.interactionHighlight,
  },
  numberBadgeSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  answerField: {
    // body 向外借了一圈留白给行的悬停底色，输入框不需要，还回去。
    marginHorizontal: theme.spacing[2],
  },
  otherInput: {
    flex: 1,
    padding: 0,
    ...theme.typeScale.body,
    color: theme.colors.foreground,
    outlineWidth: 0,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
