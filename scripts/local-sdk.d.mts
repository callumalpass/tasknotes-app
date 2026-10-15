export interface LocalSdkReceipt {
  readonly schema: "tasknotes/local-sdk-build/1";
  readonly sourceCommit: string;
  readonly archive: string;
  readonly archiveSha256: string;
  readonly trustAssetSha256: string;
  readonly runtimeSha256: string;
}
export function readLocalSdkReceipt(root?: string): Readonly<LocalSdkReceipt>;
export function prepareLocalSdk(root?: string): string;
