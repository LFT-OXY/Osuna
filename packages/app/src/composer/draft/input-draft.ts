import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserComposerAttachment } from "@/attachments/types";
import type { TextReplacement } from "@/composer/types";
import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { DraftCommandConfig } from "@/hooks/use-agent-commands-query";
import {
  useAgentFormState,
  type CreateAgentInitialValues,
  type UseAgentFormStateResult,
} from "@/hooks/use-agent-form-state";
import { useDraftAgentFeatures } from "@/hooks/use-draft-agent-features";
import {
  buildDraftAgentControls,
  resolveDraftKey,
  type DraftKeyInput,
} from "@/composer/draft/input-draft-core";
import {
  buildDraftCommandConfig,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  type ProviderSelectionState,
} from "@/provider-selection/provider-selection";
import { hasDraftContent, useDraftStore, type DraftInput } from "@/stores/draft-store";
import { AfterPaintPublication } from "@/composer/after-paint-publication";
import { useShallow } from "zustand/shallow";
import type { ComposerTextSource } from "@/composer/text-source";
import { isWeb } from "@/constants/platform";
import type { InlineSegment } from "@/inline-blocks";

type AttachmentUpdater =
  | UserComposerAttachment[]
  | ((prev: UserComposerAttachment[]) => UserComposerAttachment[]);

interface AgentInputDraftComposerOptions {
  initialServerId: string | null;
  initialValues?: CreateAgentInitialValues;
  initialFeatureValues?: Record<string, unknown>;
  isVisible?: boolean;
  lockedWorkingDir?: string;
}

interface UseAgentInputDraftInput {
  draftKey: DraftKeyInput;
  composer?: AgentInputDraftComposerOptions;
}

type DraftComposerState = UseAgentFormStateResult & {
  workingDir: string;
  effectiveModelId: string;
  effectiveThinkingOptionId: string;
  featureValues: Record<string, unknown> | undefined;
  agentControls: DraftAgentControlsProps;
  commandDraftConfig: DraftCommandConfig | undefined;
};

/** 输入框的一次内容：text 是发出去的文字，segments 是 Web 输入框的分段结构（含块时以它为准）。 */
interface DraftTextEdit {
  text: string;
  segments?: readonly InlineSegment[];
}

export interface AgentInputDraft {
  textSource: ComposerTextSource;
  editText: (text: string, segments?: readonly InlineSegment[]) => void;
  /** 程序写入内容（Rewind 等）；有 segments 时块写回成块。 */
  replaceText: (text: string, segments?: readonly InlineSegment[]) => void;
  textReplacement: TextReplacement;
  attachments: UserComposerAttachment[];
  setAttachments: (updater: AttachmentUpdater) => void;
  clear: (lifecycle: "sent" | "abandoned") => void;
  isHydrated: boolean;
  attachmentFocusRequestId: number;
  composerState: DraftComposerState | null;
}

export function useAgentInputDraft(input: UseAgentInputDraftInput): AgentInputDraft {
  const composerOptions = input.composer ?? null;
  const workingDir = composerOptions?.lockedWorkingDir?.trim() || "";
  const formState = useAgentFormState({
    workingDir,
    serverId: composerOptions?.initialServerId ?? null,
    initialValues: composerOptions?.initialValues,
    isVisible: composerOptions?.isVisible ?? false,
    isCreateFlow: true,
  });
  const draftKey = useMemo(
    () =>
      resolveDraftKey({
        draftKey: input.draftKey,
        selectedServerId: formState.selectedServerId,
      }),
    [formState.selectedServerId, input.draftKey],
  );
  const attachments = useDraftStore(
    useShallow((state) =>
      state.drafts[draftKey]?.lifecycle === "active"
        ? (state.drafts[draftKey].input.attachments ?? [])
        : [],
    ),
  );
  const textSource = useMemo<ComposerTextSource>(
    () => ({
      getSnapshot: () => {
        const record = useDraftStore.getState().drafts[draftKey];
        return record?.lifecycle === "active" ? record.input.text : "";
      },
      getSegmentsSnapshot: () => {
        const record = useDraftStore.getState().drafts[draftKey];
        return record?.lifecycle === "active" ? record.input.segments : undefined;
      },
      subscribe: (listener) =>
        useDraftStore.subscribe((state, previous) => {
          if (
            state.drafts[draftKey]?.input.text !== previous.drafts[draftKey]?.input.text ||
            state.drafts[draftKey]?.lifecycle !== previous.drafts[draftKey]?.lifecycle
          )
            listener();
        }),
    }),
    [draftKey],
  );
  const attachmentFocusRequestId = useDraftStore(
    (state) => state.attachmentFocusRequestByDraftKey[draftKey] ?? 0,
  );
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const isHydrated = hydratedDraftKey === draftKey;
  const textReplacementRevisionRef = useRef(0);
  const [textReplacement, setTextReplacement] = useState<TextReplacement>(() => ({
    key: `${draftKey}:0`,
    text: textSource.getSnapshot(),
  }));

  const publishTextReplacement = useCallback(
    (edit: DraftTextEdit) => {
      textReplacementRevisionRef.current += 1;
      setTextReplacement({
        key: `${draftKey}:${textReplacementRevisionRef.current}`,
        text: edit.text,
        ...(edit.segments ? { segments: edit.segments } : {}),
      });
    },
    [draftKey],
  );

  const saveDraft = useCallback(
    (update: (draft: DraftInput) => DraftInput) => {
      const store = useDraftStore.getState();
      const current = store.getDraftInput(draftKey) ?? { text: "", attachments: [] };
      const next = update(current);
      if (!hasDraftContent(next)) {
        store.clearDraftInput({ draftKey, lifecycle: "abandoned" });
        return;
      }
      store.saveDraftInput({ draftKey, draft: next });
    },
    [draftKey],
  );

  const textPublication = useMemo(
    () =>
      new AfterPaintPublication<DraftTextEdit>((edit) => {
        useDraftStore.getState().editDraftText({ draftKey, ...edit });
      }),
    [draftKey],
  );

  const editText = useCallback(
    (text: string, segments?: readonly InlineSegment[]) => {
      if (isWeb) {
        textPublication.stage({ text, segments });
      } else {
        useDraftStore.getState().editDraftText({ draftKey, text, segments });
      }
    },
    [draftKey, textPublication],
  );

  const replaceText = useCallback(
    (text: string, segments?: readonly InlineSegment[]) => {
      textPublication.cancel();
      useDraftStore.getState().editDraftText({ draftKey, text, segments });
      publishTextReplacement({ text, segments });
    },
    [draftKey, publishTextReplacement, textPublication],
  );

  const setAttachments = useCallback(
    (updater: AttachmentUpdater) => {
      saveDraft((current) => ({
        ...current,
        attachments: typeof updater === "function" ? updater(current.attachments) : updater,
      }));
    },
    [saveDraft],
  );

  const clear = useCallback(
    (lifecycle: "sent" | "abandoned") => {
      textPublication.cancel();
      useDraftStore.getState().clearDraftInput({ draftKey, lifecycle });
    },
    [draftKey, textPublication],
  );

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") textPublication.flush();
    };
    const flush = () => textPublication.flush();
    const canListenForPageHide =
      isWeb && typeof window !== "undefined" && typeof window.addEventListener === "function";
    if (isWeb && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", flushWhenHidden);
    }
    if (canListenForPageHide) {
      window.addEventListener("pagehide", flush);
    }
    return () => {
      if (isWeb && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", flushWhenHidden);
      }
      if (canListenForPageHide) {
        window.removeEventListener("pagehide", flush);
      }
      textPublication.flush();
    };
  }, [textPublication]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await useDraftStore.getState().hydrateDraftInput({ draftKey });
      if (!cancelled) {
        const hydrated = useDraftStore.getState().getDraftInput(draftKey);
        publishTextReplacement({ text: hydrated?.text ?? "", segments: hydrated?.segments });
        setHydratedDraftKey(draftKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftKey, publishTextReplacement]);

  const providerSelection = useMemo<ProviderSelectionState>(
    () => ({
      provider: formState.selectedProvider,
      modelId: formState.selectedModel,
      modeId: formState.selectedMode,
      thinkingOptionId: formState.selectedThinkingOptionId,
      availableModels: formState.availableModels,
      modeOptions: formState.modeOptions,
    }),
    [
      formState.availableModels,
      formState.modeOptions,
      formState.selectedMode,
      formState.selectedModel,
      formState.selectedProvider,
      formState.selectedThinkingOptionId,
    ],
  );

  const effectiveModelId = useMemo(
    () => resolveEffectiveComposerModelId(providerSelection),
    [providerSelection],
  );

  const effectiveThinkingOptionId = useMemo(
    () => resolveEffectiveComposerThinkingOptionId(providerSelection, effectiveModelId),
    [effectiveModelId, providerSelection],
  );

  const {
    features: draftFeatures,
    featureValues: draftFeatureValues,
    setFeatureValue: setDraftFeatureValue,
    applyProfileFeatureValues,
  } = useDraftAgentFeatures({
    serverId: formState.selectedServerId,
    provider: formState.selectedProvider,
    cwd: workingDir,
    modeId: formState.selectedMode,
    modelId: effectiveModelId,
    thinkingOptionId: effectiveThinkingOptionId,
    initialFeatureValues: composerOptions?.initialFeatureValues,
  });

  const applyDraftAgentProfile = useCallback(
    (profile: Parameters<typeof formState.applyProfileFromUser>[0]) => {
      formState.applyProfileFromUser(profile);
      applyProfileFeatureValues(profile.featureValues);
    },
    [applyProfileFeatureValues, formState],
  );

  const commandDraftConfig = useMemo(
    () =>
      composerOptions
        ? buildDraftCommandConfig({
            selection: providerSelection,
            cwd: workingDir,
            effectiveModelId,
            effectiveThinkingOptionId,
            featureValues: draftFeatureValues,
          })
        : undefined,
    [
      composerOptions,
      effectiveModelId,
      effectiveThinkingOptionId,
      draftFeatureValues,
      providerSelection,
      workingDir,
    ],
  );

  const composerState = useMemo<DraftComposerState | null>(() => {
    if (!composerOptions) {
      return null;
    }

    return {
      ...formState,
      workingDir,
      effectiveModelId,
      effectiveThinkingOptionId,
      featureValues: draftFeatureValues,
      agentControls: buildDraftAgentControls({
        formState,
        features: draftFeatures,
        onSetFeature: setDraftFeatureValue,
        onApplyAgentProfile: applyDraftAgentProfile,
      }),
      commandDraftConfig,
    };
  }, [
    commandDraftConfig,
    composerOptions,
    effectiveModelId,
    effectiveThinkingOptionId,
    draftFeatures,
    draftFeatureValues,
    applyDraftAgentProfile,
    formState,
    setDraftFeatureValue,
    workingDir,
  ]);

  return {
    textSource,
    editText,
    replaceText,
    textReplacement,
    attachments,
    setAttachments,
    clear,
    isHydrated,
    attachmentFocusRequestId,
    composerState,
  };
}

export const __private__ = {
  resolveDraftKey,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  buildDraftCommandConfig,
  buildDraftComposerCommandConfig: buildDraftCommandConfig,
  buildDraftAgentControls,
};
