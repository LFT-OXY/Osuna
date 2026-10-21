import React, { useMemo } from "react";
import { Alert, type AlertProps } from "@/components/ui/alert";
import { Text } from "@/components/ui/text";

/** 本页的提示框：说明文字用主文字色（共用 Alert 的默认是次要色，在色底上读不清），尺寸统一 sm。 */
export function PrimaryTextAlert({
  description,
  ...alert
}: Omit<AlertProps, "description" | "size"> & { description?: string }) {
  const body = useMemo(() => {
    if (!description) return undefined;
    return (
      <Text color="foreground" selectable>
        {description}
      </Text>
    );
  }, [description]);
  return <Alert {...alert} size="sm" description={body} />;
}
