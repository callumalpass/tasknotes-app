import { AppCollectionSetupJournal } from "@mdbase-dev/sdk/app-host";
import type { ModelSetupScope } from "../application/ports/model-setup";

export {
  AppCollectionSetupError as NextModelSetupStorageError,
  decodeAppCollectionSetupIntent as decode,
  appModelPackPlan as modelPackPlan,
  appModelResourcePlan as modelResourcePlan,
} from "@mdbase-dev/sdk/app-host";

/** Original TaskNotes configuration only; sealing, codec and CAS are SDK-owned. */
export class NextModelSetupIntentStore extends AppCollectionSetupJournal {
  constructor(
    owner: Readonly<{
      scope: ModelSetupScope;
      appOrigin: string;
      cpOrigin: string;
      isCurrent(): boolean;
    }>,
  ) {
    super({
      ...owner,
      databaseName: "tasknotes.native-model-setup.v1",
      applicationNamespace: "tasknotes-web",
    });
  }
}
