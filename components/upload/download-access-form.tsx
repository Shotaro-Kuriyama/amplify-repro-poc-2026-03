"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type DownloadAccessFormProps = {
  artifactUrl: string;
};

type DownloadFormValues = {
  companyName: string;
  country: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationType: string;
};

const initialValues: DownloadFormValues = {
  companyName: "",
  country: "",
  email: "",
  firstName: "",
  lastName: "",
  organizationType: "",
};

const countryOptions = ["日本", "アメリカ", "イギリス", "ドイツ", "フランス", "その他"];
const organizationTypeOptions = ["設計事務所", "施工会社", "デベロッパー", "メーカー", "教育機関", "その他"];

const inputClassName =
  "mt-2 w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-sky-400";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function DownloadAccessForm({ artifactUrl }: DownloadAccessFormProps) {
  const [values, setValues] = useState<DownloadFormValues>(initialValues);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);

  const isComplete = useMemo(
    () => Object.values(values).every((value) => value.trim().length > 0),
    [values],
  );

  useEffect(() => {
    setValues(initialValues);
    setErrorMessage(null);
    setIsUnlocked(false);
  }, [artifactUrl]);

  function updateField<K extends keyof DownloadFormValues>(key: K, nextValue: string) {
    setErrorMessage(null);
    setIsUnlocked(false);
    setValues((current) => ({
      ...current,
      [key]: nextValue,
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isComplete) {
      setIsUnlocked(false);
      setErrorMessage("すべての項目を入力してください。");
      return;
    }

    if (!isValidEmail(values.email)) {
      setIsUnlocked(false);
      setErrorMessage("メールアドレスの形式が正しくありません。");
      return;
    }

    setErrorMessage(null);
    setIsUnlocked(true);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
        <p className="text-sm uppercase tracking-[0.28em] text-slate-400">ダウンロード前フォーム</p>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          ダウンロード前に連絡先情報を入力してください。送信成功後に成果物リンクを解放します。
        </p>

        <form className="mt-4 grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-200">
              名
              <input
                className={inputClassName}
                placeholder="Taro"
                type="text"
                value={values.firstName}
                onChange={(event) => updateField("firstName", event.target.value)}
              />
            </label>
            <label className="text-sm text-slate-200">
              姓
              <input
                className={inputClassName}
                placeholder="Yamada"
                type="text"
                value={values.lastName}
                onChange={(event) => updateField("lastName", event.target.value)}
              />
            </label>
          </div>

          <label className="text-sm text-slate-200">
            メールアドレス
            <input
              className={inputClassName}
              placeholder="name@example.com"
              type="email"
              value={values.email}
              onChange={(event) => updateField("email", event.target.value)}
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-200">
              国
              <select
                className={inputClassName}
                value={values.country}
                onChange={(event) => updateField("country", event.target.value)}
              >
                <option className="text-slate-900" value="">
                  選択してください
                </option>
                {countryOptions.map((option) => (
                  <option key={option} className="text-slate-900" value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-200">
              組織種別
              <select
                className={inputClassName}
                value={values.organizationType}
                onChange={(event) => updateField("organizationType", event.target.value)}
              >
                <option className="text-slate-900" value="">
                  選択してください
                </option>
                {organizationTypeOptions.map((option) => (
                  <option key={option} className="text-slate-900" value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="text-sm text-slate-200">
            会社名
            <input
              className={inputClassName}
              placeholder="OpenAI"
              type="text"
              value={values.companyName}
              onChange={(event) => updateField("companyName", event.target.value)}
            />
          </label>

          {errorMessage ? (
            <Alert className="border-rose-400/50 bg-rose-400/10 text-rose-50">
              <AlertTitle>入力エラー</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          {isUnlocked ? (
            <Alert className="border-emerald-400/50 bg-emerald-400/10 text-emerald-50">
              <AlertTitle>ダウンロード解放済み</AlertTitle>
              <AlertDescription>
                フォーム送信を受け付けました。成果物をダウンロードできます。
              </AlertDescription>
            </Alert>
          ) : null}

          <Button className="w-full bg-white text-slate-950 hover:bg-slate-100" type="submit">
            送信してダウンロードを解放
          </Button>
        </form>
      </div>

      {isUnlocked ? (
        <Button asChild className="w-full bg-white text-slate-950 hover:bg-slate-100">
          <a href={artifactUrl} rel="noreferrer" target="_blank">
            IFCをダウンロード
          </a>
        </Button>
      ) : null}
    </div>
  );
}
