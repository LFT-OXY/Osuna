import { useCallback, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { type LayoutChangeEvent, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { Copy, ExternalLink as ExternalLinkIcon } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { ProviderAccountError } from "@getpaseo/protocol/provider-account/rpc-schemas";
import type { AccountSignInView, PasteState } from "./use-account-sign-in";

/*
 * 加号与重新登录的对话框：进行中「在浏览器里完成登录」、打开登录页、复制链接；
 * 浏览器回不到主机（远程设备、主机的回调端口被占、Claude Code 没打开页面）时多一个输入框：
 * Codex 粘贴浏览器最后跳到的地址，Claude Code 粘贴登录页显示的代码；
 * 失败、超时留在框里显示原因与「重试」。成功时由 view.tsx 关掉并高亮新号。
 */

const KEY = "settings.providers.accounts.signIn";
const SHEET_WIDTH = 520;
// 手机上量出正文高度之前先用的高度。
const UNMEASURED_SNAP_POINTS = ["60%"];
// 手机上正文以外的高度：把手、标题栏、正文上下留白、底部按钮栏（同风险提示）。
const COMPACT_SHEET_CHROME_HEIGHT = 192;
const MAX_SNAP_PERCENT = 90;

// 主机给的、客户端能翻译的失败原因；refused、exchange_failed 后面接主机给的原文。
const FAILURE_CODES = new Set([
  "timed_out",
  "refused",
  "exchange_failed",
  "no_account",
  "different_account",
  "cli_sign_ins_off",
  "no_email",
  "login_failed",
]);
const PASTE_CODES = new Set(["paste_invalid", "paste_mismatch", "code_invalid", "not_waiting"]);

export interface ProviderAccountSignInSheetProps {
  provider: string;
  providerLabel: string;
  view: Exclude<AccountSignInView, { kind: "closed" }>;
  // 浏览器回得到主机：主机就是这台电脑，且回调端口开着。
  callbackReachable: boolean;
  onOpenSignInPage: () => void;
  onCopyLink: () => void;
  onSubmitPaste: (callbackUrl: string) => void;
  onRetry: () => void;
  onClose: () => void;
}

export function ProviderAccountSignInSheet(props: ProviderAccountSignInSheetProps) {
  const { providerLabel, view, onClose, onRetry } = props;
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();
  const { bottom: safeAreaBottom } = useSafeAreaInsets();
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const handleBodyLayout = useCallback(
    (event: LayoutChangeEvent) => setBodyHeight(event.nativeEvent.layout.height),
    [],
  );
  // 手机上底部面板刚好装下正文：进行中、失败两种状态高度不同。
  const snapPoints = useMemo(() => {
    if (bodyHeight === null || windowHeight <= 0) return UNMEASURED_SNAP_POINTS;
    const needed = COMPACT_SHEET_CHROME_HEIGHT + bodyHeight + safeAreaBottom;
    return [`${Math.min(MAX_SNAP_PERCENT, Math.ceil((needed / windowHeight) * 100))}%`];
  }, [bodyHeight, safeAreaBottom, windowHeight]);
  const email = view.email;
  const header = useMemo<SheetHeader>(
    () => ({
      title: email
        ? t(`${KEY}.reSignInTitle`, { email })
        : t(`${KEY}.addTitle`, { name: providerLabel }),
    }),
    [email, providerLabel, t],
  );
  const failed =
    view.kind === "start_failed" || (view.kind === "active" && view.signIn.status !== "waiting");
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button variant="secondary" size="sm" onPress={onClose} testID="account-sign-in-close">
          {failed ? t("common.actions.close") : t("common.actions.cancel")}
        </Button>
        {failed ? (
          <Button variant="default" size="sm" onPress={onRetry} testID="account-sign-in-retry">
            {t(`${KEY}.retry`)}
          </Button>
        ) : null}
      </View>
    ),
    [failed, onClose, onRetry, t],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={SHEET_WIDTH}
      snapPoints={snapPoints}
      testID="account-sign-in"
    >
      <View onLayout={handleBodyLayout}>
        <SignInBody {...props} />
      </View>
    </AdaptiveModalSheet>
  );
}

function SignInBody(props: ProviderAccountSignInSheetProps) {
  const { view } = props;
  const { t } = useTranslation();
  if (view.kind === "starting") {
    return (
      <View style={styles.starting} testID="account-sign-in-starting">
        <LoadingSpinner color={styles.spinnerColor.color} />
        <Text style={styles.hint}>{t(`${KEY}.starting`)}</Text>
      </View>
    );
  }
  if (view.kind === "start_failed") {
    return (
      <Alert
        size="sm"
        variant="error"
        title={failedTitle(t, view)}
        description={t(`${KEY}.startFailed`, { reason: view.message })}
        testID="account-sign-in-failed"
      />
    );
  }
  const { signIn } = view;
  if (signIn.status === "failed") {
    return (
      <Alert
        size="sm"
        variant="error"
        title={failedTitle(t, view)}
        description={failureText(t, signIn.error)}
        testID="account-sign-in-failed"
      />
    );
  }
  if (signIn.status === "canceled") {
    return (
      <Alert
        size="sm"
        variant="error"
        title={failedTitle(t, view)}
        description={t(`${KEY}.canceled`)}
        testID="account-sign-in-failed"
      />
    );
  }
  return <WaitingBody {...props} paste={view.paste} blocked={signIn.callbackBlocked} />;
}

function WaitingBody(
  props: ProviderAccountSignInSheetProps & { paste: PasteState; blocked: boolean },
) {
  const {
    provider,
    paste,
    callbackReachable,
    blocked,
    onOpenSignInPage,
    onCopyLink,
    onSubmitPaste,
  } = props;
  const { t } = useTranslation();
  // Claude Code 粘贴的是代码，文字另有一套。
  const copy = provider === "claude" ? `${KEY}.claude` : KEY;
  const [draft, setDraft] = useState("");
  const submit = useCallback(() => {
    if (draft.trim()) onSubmitPaste(draft.trim());
  }, [draft, onSubmitPaste]);
  const showsPaste = !callbackReachable || blocked;
  return (
    <View style={styles.body} testID="account-sign-in-waiting">
      <View style={styles.lead}>
        <Text style={styles.title}>{t(`${KEY}.waitingTitle`)}</Text>
        <Text style={styles.hint}>{t(`${copy}.waitingHint`)}</Text>
      </View>
      <View style={styles.buttons}>
        <Button
          variant="default"
          size="sm"
          leftIcon={ExternalLinkIcon}
          onPress={onOpenSignInPage}
          testID="account-sign-in-open"
        >
          {t(`${KEY}.openPage`)}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={Copy}
          onPress={onCopyLink}
          testID="account-sign-in-copy"
        >
          {t(`${KEY}.copyLink`)}
        </Button>
      </View>
      {showsPaste ? (
        <View style={styles.paste}>
          <Field
            label={t(`${copy}.pasteLabel`)}
            hint={blocked ? t(`${copy}.pasteHintBlocked`) : t(`${copy}.pasteHint`)}
            error={paste.error ? pasteErrorText(t, paste.error) : null}
            reservesTwoLines
            testID="account-sign-in-paste"
          >
            <FormTextInput
              initialValue=""
              onChangeText={setDraft}
              onSubmitEditing={submit}
              placeholder={
                provider === "claude" ? undefined : "http://localhost:1455/auth/callback?code=…"
              }
              autoCapitalize="none"
              autoCorrect={false}
              editable={!paste.submitting}
              accessibilityLabel={t(`${copy}.pasteLabel`)}
              testID="account-sign-in-paste-input"
            />
          </Field>
          <View style={styles.pasteActions}>
            <Button
              variant="secondary"
              size="sm"
              onPress={submit}
              disabled={draft.trim() === "" || paste.submitting}
              loading={paste.submitting}
              testID="account-sign-in-paste-submit"
            >
              {t(`${KEY}.pasteSubmit`)}
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** 失败框的标题：加号是「没能添加这个号」，重新登录是「没能重新登录」。 */
function failedTitle(t: TFunction, view: ProviderAccountSignInSheetProps["view"]): string {
  const accountId = view.kind === "active" ? view.signIn.accountId : view.accountId;
  return accountId === undefined ? t(`${KEY}.addFailedTitle`) : t(`${KEY}.reSignInFailedTitle`);
}

function failureText(t: TFunction, error: ProviderAccountError): string {
  if (!FAILURE_CODES.has(error.code)) return t(`${KEY}.failed`, { reason: error.message });
  return t(`${KEY}.failures.${error.code}`, { reason: error.message });
}

function pasteErrorText(t: TFunction, error: ProviderAccountError): string {
  if (PASTE_CODES.has(error.code)) return t(`${KEY}.pasteErrors.${error.code}`);
  return error.message;
}

const styles = StyleSheet.create((theme) => ({
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
  starting: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  body: {
    gap: theme.spacing[4],
  },
  lead: {
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  buttons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  paste: {
    gap: theme.spacing[2],
  },
  pasteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
