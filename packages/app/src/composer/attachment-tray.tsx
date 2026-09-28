import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SkillChipPill } from "./skill-chip-pill";
import type { SkillChip } from "./skill-chips";

interface ComposerAttachmentTrayProps {
  skillChips: readonly SkillChip[];
  hasAttachments: boolean;
  disabled: boolean;
  onRemoveSkillChip: (name: string) => void;
  labels: {
    skillChip: (name: string) => string;
    removeSkill: string;
  };
  /** 附件 pill，排在所有 Skill chip 之后。 */
  children?: ReactNode;
}

/** Attachment tray：Skill chip 在前、附件在后，同一行；两者都没有时不渲染。 */
export function ComposerAttachmentTray({
  skillChips,
  hasAttachments,
  disabled,
  onRemoveSkillChip,
  labels,
  children,
}: ComposerAttachmentTrayProps) {
  if (!hasAttachments && skillChips.length === 0) return null;
  return (
    <View style={styles.tray} testID="composer-attachment-tray">
      {skillChips.map((chip) => (
        <SkillChipPill
          key={`skill:${chip.name}`}
          chip={chip}
          disabled={disabled}
          onRemove={onRemoveSkillChip}
          label={labels.skillChip(chip.name)}
          removeLabel={labels.removeSkill}
        />
      ))}
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  tray: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
}));
