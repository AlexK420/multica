"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@multica/ui/components/ui/select";
import { useIssueOpeningStore, type IssueOpenMode } from "@multica/core/issues/stores/issue-opening-store";
import { Switch } from "@multica/ui/components/ui/switch";
import {
  MANUAL_CREATE_FIELDS,
  QUICK_CREATE_FIELDS,
  useIssueCreateSettingsStore,
} from "@multica/core/issues/stores/issue-create-settings-store";
import { toast } from "sonner";
import { useT } from "../../i18n";
import { SettingsCard, SettingsRow, SettingsSection } from "./settings-layout";

/**
 * Device-wide opening behavior, followed by workspace-scoped create toolbar
 * fields. Hidden fields stay reachable from the dialog's ⋯ menu and reappear
 * while they hold a value.
 */
export function IssueTab() {
  const { t } = useT("settings");
  const quickFields = useIssueCreateSettingsStore((s) => s.quickCreateFields);
  const setQuickVisible = useIssueCreateSettingsStore(
    (s) => s.setQuickCreateFieldVisible,
  );
  const manualFields = useIssueCreateSettingsStore((s) => s.manualCreateFields);
  const setManualVisible = useIssueCreateSettingsStore(
    (s) => s.setManualCreateFieldVisible,
  );

  const savedToast = () =>
    toast.success(
      t(($) => $.auto_save.toast_saved),
      { id: "settings-auto-save" },
    );

  return (
    <div className="space-y-8">
      <IssueOpeningSection />
      <p className="text-caption text-muted-foreground">
        {t(($) => $.preferences.issue_scope)}
      </p>
      <SettingsSection
        title={t(($) => $.issue.quick_create_title)}
      >
        <SettingsCard>
          {QUICK_CREATE_FIELDS.map((field) => (
            <SettingsRow key={field} label={t(($) => $.issue.fields[field])}>
              <Switch
                checked={quickFields.includes(field)}
                onCheckedChange={(checked) => {
                  setQuickVisible(field, checked);
                  savedToast();
                }}
                aria-label={t(($) => $.issue.fields[field])}
              />
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t(($) => $.issue.manual_create_title)}
      >
        <SettingsCard>
          {MANUAL_CREATE_FIELDS.map((field) => (
            <SettingsRow key={field} label={t(($) => $.issue.fields[field])}>
              <Switch
                checked={manualFields.includes(field)}
                onCheckedChange={(checked) => {
                  setManualVisible(field, checked);
                  savedToast();
                }}
                aria-label={t(($) => $.issue.fields[field])}
              />
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

function IssueOpeningSection() {
  const { t } = useT("settings");
  const value = useIssueOpeningStore((s) => s.openMode);
  const setValue = useIssueOpeningStore((s) => s.setOpenMode);
  const options: { value: IssueOpenMode; label: string }[] = [
    { value: "page", label: t(($) => $.issue.opening.page) },
    { value: "peek", label: t(($) => $.issue.opening.peek) },
  ];
  return (
    <SettingsSection
      title={t(($) => $.issue.opening.title)}
      description={t(($) => $.preferences.device_hint)}
    >
      <SettingsCard>
        <SettingsRow
          label={t(($) => $.issue.opening.click)}
          size="select"
        >
          <Select
            items={options}
            value={value}
            onValueChange={(next) => {
              if ((next !== "page" && next !== "peek") || next === value) return;
              setValue(next);
              toast.success(t(($) => $.auto_save.toast_saved), { id: "settings-auto-save" });
            }}
          >
            <SelectTrigger size="sm" className="w-full" aria-label={t(($) => $.issue.opening.click)}>
              <SelectValue>{options.find((option) => option.value === value)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
