import { TaskSelectionProvider } from "./task-selection";
import { useLingui as useI18n } from "@lingui/react";
import { useLingui } from "@lingui/react/macro";
import { Trans } from "@lingui/react/macro";
import { t as translate } from "@lingui/core/macro";
import {
  Folder,
  ClockAlert,
  PanelLeftClose,
  PanelLeftOpen,
  Columns3,
  Command,
  Ellipsis,
  FilePenLine,
  Library,
  Plus,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ConnectionNoticeContext } from "./connection-notice";
import { createPortal } from "react-dom";
import { moveMenuFocus } from "@mdbase-dev/ui/popover";

import { CollectionAvailability } from "../components/collection-availability";
import { CollectionWriteStatus } from "../components/collection-write-status";
import {
  WorkspaceFeedback,
  FeedbackNotice,
} from "../components/workspace-feedback";
import { TaskAddedNotice } from "../components/task-added-notice";
import { TaskCompletedNotice } from "../components/task-completed-notice";
import { onProjectJump, requestProjectJump } from "./project-jump";
import { useProjectShortcuts } from "./use-project-shortcuts";
import {
  clearUndoHistory,
  forgetUndo,
  rememberUndo,
  takeUndo,
  type UndoEntry,
} from "./undo-history";
import {
  TaskCompletionReportContext,
  type TaskCompletion,
} from "../components/task-completion-motion";
import type { TaskSummary } from "../domain/task";
import { useKeyboardOcclusion } from "../components/use-keyboard-occlusion";
import { useSidebarReorder } from "./use-sidebar-reorder";
import { taskViewIcon } from "./views/view-icon";
import { useOverlay } from "../components/overlays/use-overlay";
import {
  useExitingValue,
  usePresence,
} from "../components/overlays/use-presence";
import { LoadingRows } from "../components/loading";
import { GlobalTaskCapture } from "../components/global-task-capture";
import { OperationErrorNotice } from "../components/operation-error-notice";
import {
  useWorkspaceNavigation,
  type Route,
  type WorkspaceRoute,
} from "./use-workspace-navigation";
import { tasknotesMarkUrl } from "./assets";
import { isAuthorizationError } from "./auth-error";
import {
  CollectionSwitcher,
  useCollectionUi,
  type CollectionUiOptions,
} from "@mdbase-dev/ui/collections";
import { useCollectionGate } from "./collection-context";
import { countLabel } from "../i18n/default-labels";
import type { TodayTaskCounts } from "../domain/today-summary";
import { useTodayTaskCounts } from "./use-today-task-counts";
import {
  readSidebarCollapsed,
  saveSidebarCollapsed,
} from "./sidebar-preferences";
import { starterViewKind } from "../domain/default-view-source";
import { viewNavigationShortcut } from "./palette-commands";
import { KeyboardLayer } from "./keyboard-layer";
import {
  isApplePlatform,
  isEditableTarget,
  shortcutLabel,
} from "./keyboard-shortcuts";
import { useRepository } from "./repository-context";
import { MoreScreen } from "./more-screen";
import { SearchScreen } from "./search-screen";
import { ScratchpadScreen } from "./scratchpad-screen";
import {
  SCRATCHPAD_NAVIGATION_KEY,
  SEARCH_NAVIGATION_KEY,
} from "./navigation-views";
import { TaskScreen } from "./task-screen";
import { useNavigationViews } from "./use-navigation-views";
import { useAddStarterViews } from "./use-starter-views";
import { ViewsScreen } from "./views-screen";
import { CaptureFab } from "../components/capture-fab";
import { ModelSetupScreen } from "./model-setup-screen";
import { TaskNotesModelRequiredError } from "../application/ports/model-setup";
import { requestRecordWriteReview } from "../components/record-write-status-context";
import {
  loadCalendarPreferences,
  saveCalendarPreferences,
  type CalendarPreferences,
} from "./calendar-preferences";

import type { ProjectShortcut } from "../domain/project-shortcuts";
import type { TaskView } from "../domain/view";
import type { OperationalError } from "../application/operational-error";

export function AppShell() {
  const { t } = useLingui();
  const keyboardOccluded = useKeyboardOcclusion();
  const todayCounts = useTodayTaskCounts();
  const projectLinks = useProjectShortcuts();
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(readSidebarCollapsed);
  const toggleSidebar = useCallback(
    () =>
      setSidebarCollapsed((current) => {
        saveSidebarCollapsed(!current);
        return !current;
      }),
    [],
  );
  const {
    repository,
    connection,
    reminderAuthority,
    status,
    error,
    refresh,
    pendingDeletion,
    deletionError,
    undoTaskDeletion,
    retryTaskDeletion,
    deleteTask,
    setTaskCompletion,
    updateTask,
  } = useRepository();
  const { collectionUi, changeCollection, reauthorizeCurrentCollection } =
    useCollectionGate();
  const {
    documents,
    views,
    discovery,
    refreshing: discoveringViews,
    navigationViews,
    navigationKeys,
    homeKey,
    loading: viewsLoading,
    refresh: refreshViews,
    toggleNavigationView,
    moveNavigationView,
  } = useNavigationViews();
  const { route, workspaceRoute, navigate, detailRef, taskOrder } =
    useWorkspaceNavigation(navigationViews);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [paletteRequest, setPaletteRequest] = useState(0);
  const openCapture = useCallback(() => setCaptureOpen(true), []);
  const [viewCreationRequest, setViewCreationRequest] = useState(0);
  const [addedNotice, setAddedNotice] = useState<{
    task: TaskSummary;
    repository: typeof repository;
    route: Route;
  }>();
  const reportAdded = (task: TaskSummary) => {
    setCompletedNotice(undefined);
    setAddedNotice({ task, repository, route });
  };
  const addedTask = addedNotice?.task;
  if (
    addedNotice &&
    (addedNotice.repository !== repository ||
      addedNotice.route !== route ||
      captureOpen ||
      pendingDeletion ||
      deletionError)
  ) {
    setAddedNotice(undefined);
  }
  // The latest confirmation wins; completing replaces Task added and vice versa.
  const [completedNotice, setCompletedNotice] = useState<{
    completion: TaskCompletion;
    repository: typeof repository;
    route: Route;
  }>();
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = route;
  });
  useEffect(
    () =>
      onProjectJump(() => {
        const key = views?.find(
          (view) => starterViewKind(view) === "projects",
        )?.key;
        if (key) navigate({ page: "views", key });
      }),
    [navigate, views],
  );
  const completionUndo = useRef<UndoEntry | undefined>(undefined);
  const undoCompletion = useCallback(
    async ({ task, occurrenceDate, advanced }: TaskCompletion) => {
      await setTaskCompletion({
        id: task.id,
        occurrenceDate,
        completed: false,
      });
      if (advanced) await updateTask(task.id, advanced);
    },
    [setTaskCompletion, updateTask],
  );
  const reportCompleted = useCallback(
    (completion: TaskCompletion) => {
      setAddedNotice(undefined);
      setCompletedNotice({ completion, repository, route: routeRef.current });
      completionUndo.current = {
        label: completion.task.title,
        run: () => undoCompletion(completion),
      };
      rememberUndo(completionUndo.current);
    },
    [repository, undoCompletion],
  );
  const dismissCompleted = useCallback(() => setCompletedNotice(undefined), []);
  if (
    completedNotice &&
    (completedNotice.repository !== repository ||
      completedNotice.route !== route ||
      captureOpen ||
      pendingDeletion ||
      deletionError)
  ) {
    setCompletedNotice(undefined);
  }
  const [calendarPreferences, setCalendarPreferences] =
    useState<CalendarPreferences>(loadCalendarPreferences);
  const updateCalendarPreferences = useCallback((next: CalendarPreferences) => {
    saveCalendarPreferences(next);
    setCalendarPreferences(next);
  }, []);
  const closeCapture = useCallback(() => setCaptureOpen(false), []);
  const viewsCatalogOpen = route.page === "views" && !route.key;

  useEffect(() => {
    if (viewsCatalogOpen) void refreshViews();
  }, [refreshViews, viewsCatalogOpen]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() !== "n" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey
      )
        return;
      event.preventDefault();
      setCaptureOpen(true);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  useEffect(() => {
    // The next entry has no reminder authority. Do not load a legacy owner or
    // register/listen to notifications just because its workspace rendered.
    if (reminderAuthority !== "connect") return;
    let active = true;
    let stop: (() => void) | undefined;
    void import("../native/mdbase-notifications")
      .then(({ mdbaseNotifications }) => {
        if (!active) return;
        stop = mdbaseNotifications.listen(({ opened }) => {
          void refresh().catch(() => undefined);
          if (opened) navigate({ page: "home" }, true);
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop?.();
    };
  }, [navigate, refresh, reminderAuthority]);

  if (status === "opening") {
    return (
      <main className="opening-screen">
        <img alt="" src={tasknotesMarkUrl} />
        <p>
          <Trans>Opening your tasks</Trans>
        </p>
        <LoadingRows count={4} />
        <button
          className="text-action opening-change-collection"
          type="button"
          onClick={changeCollection}
        >
          <Trans>Choose a different collection</Trans>
        </button>
      </main>
    );
  }
  if (status === "error") {
    if (error instanceof TaskNotesModelRequiredError && repository.modelSetup)
      return (
        <ModelSetupScreen
          setup={repository.modelSetup}
          onReady={refresh}
          changeCollection={changeCollection}
          reauthorizeCollection={reauthorizeCurrentCollection}
        />
      );
    return (
      <StorageErrorScreen
        changeCollection={changeCollection}
        error={error}
        reauthorizeCurrentCollection={reauthorizeCurrentCollection}
        retry={() => void refresh().catch(() => undefined)}
      />
    );
  }

  const workspace: WorkspaceRoute =
    route.page === "task" ? workspaceRoute : route;
  const workspacePage =
    workspace.page === "home"
      ? homeKey === SCRATCHPAD_NAVIGATION_KEY
        ? "scratchpad"
        : homeKey === SEARCH_NAVIGATION_KEY
          ? "search"
          : "view"
      : workspace.page;
  if (workspacePage !== "views" && viewCreationRequest)
    setViewCreationRequest(0);
  const workspaceViewKey =
    workspacePage === "view"
      ? homeKey
      : workspace.page === "views"
        ? workspace.key
        : undefined;
  const workspaceIsNavigationView = Boolean(
    workspaceViewKey &&
    navigationViews.some((view) => view.key === workspaceViewKey),
  );
  const showGlobalCaptureFab =
    !viewsLoading &&
    (workspacePage === "search" ||
      workspacePage === "view" ||
      Boolean(workspacePage === "views" && workspaceViewKey));
  const showBottomNavigation =
    route.page !== "task" &&
    !(workspace.page === "home" && viewsLoading) &&
    (workspacePage !== "views" ||
      !workspaceViewKey ||
      workspaceIsNavigationView);
  const activePage =
    workspaceViewKey && workspaceIsNavigationView
      ? `view:${workspaceViewKey}`
      : workspacePage === "views"
        ? "views"
        : workspacePage;
  const discoveryNotice = (
    <ViewDiscoveryNotice
      outcome={discovery}
      refreshing={discoveringViews}
      onRetry={() => void refreshViews()}
      onStarterViewsAdded={refreshViews}
      onCreate={() => {
        setViewCreationRequest((request) => request + 1);
        navigate({ page: "views" });
      }}
    />
  );
  const shell = (
    <div
      className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${route.page === "task" ? " has-detail" : ""}${keyboardOccluded ? " keyboard-occluded" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        <Trans>Skip to content</Trans>
      </a>
      <aside className="navigation-rail" aria-label={t({ message: "Primary" })}>
        <div className="rail-heading">
          <button
            aria-label="TaskNotes"
            title="TaskNotes"
            className="wordmark"
            type="button"
            onClick={() => navigate({ page: "home" })}
          >
            <img alt="" src={tasknotesMarkUrl} />
            <span>TaskNotes</span>
          </button>
          <button
            className="sidebar-toggle icon-action"
            type="button"
            aria-expanded={!sidebarCollapsed}
            aria-label={
              sidebarCollapsed
                ? t({ message: "Expand sidebar" })
                : t({ message: "Collapse sidebar" })
            }
            title={
              sidebarCollapsed ? t`Expand sidebar (M)` : t`Collapse sidebar (M)`
            }
            aria-keyshortcuts="Shift+M"
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen aria-hidden="true" size={20} />
            ) : (
              <PanelLeftClose aria-hidden="true" size={20} />
            )}
          </button>
        </div>
        {collectionUi ? (
          <CollectionSwitcher
            {...collectionUi}
            className="rail-collection-switcher"
            icon="mark"
            variant="compact"
          />
        ) : null}
        <button
          aria-keyshortcuts="Control+N Meta+N"
          aria-label={t({ message: "New task" })}
          className="global-capture-navigation"
          title={translate`New task (Q / N / ${shortcutLabel("N")})`}
          type="button"
          onClick={() => setCaptureOpen(true)}
        >
          <Plus aria-hidden="true" size={19} strokeWidth={1.8} />
          <span>
            <Trans>New task</Trans>
          </span>
          {isApplePlatform() ? <kbd>{shortcutLabel("N")}</kbd> : null}
        </button>
        <Navigation
          active={activePage}
          homeKey={homeKey}
          onMove={moveNavigationView}
          todayCounts={todayCounts}
          projects={projectLinks}
          mode="desktop"
          navigationKeys={navigationKeys}
          views={views ?? []}
          onNavigate={navigate}
          onCommands={() => setPaletteRequest((request) => request + 1)}
        />
      </aside>
      <main id="main-content" className="page-surface" tabIndex={-1}>
        {route.page !== "task" ? (
          <CollectionAvailability
            onSettings={
              workspace.page === "more" && workspace.section === "collection"
                ? undefined
                : () => navigate({ page: "more", section: "collection" })
            }
          />
        ) : null}
        {route.page !== "task" ? discoveryNotice : null}
        {workspace.page === "home" &&
        discovery === "error" &&
        documents === null ? null : workspacePage === "search" ? (
          <SearchScreen
            onBack={
              workspace.page === "home"
                ? undefined
                : () => navigate({ page: "home" }, true)
            }
            onOpen={(task, order) =>
              navigate({ page: "task", id: task.id }, false, order)
            }
          />
        ) : workspacePage === "scratchpad" ? (
          <ScratchpadScreen
            onOpenTask={(task) => navigate({ page: "task", id: task.id })}
          />
        ) : workspacePage === "more" ? (
          <MoreScreen
            calendarPreferences={calendarPreferences}
            section={workspace.page === "more" ? workspace.section : undefined}
            onCalendarPreferencesChange={updateCalendarPreferences}
            onSection={(section, replace) =>
              navigate(
                section ? { page: "more", section } : { page: "more" },
                replace,
              )
            }
          />
        ) : workspace.page === "home" && viewsLoading ? (
          <HomeViewLoading />
        ) : workspacePage === "views" || workspacePage === "view" ? (
          <ViewsScreen
            onTaskAdded={reportAdded}
            calendarPreferences={calendarPreferences}
            documents={documents}
            creationRequest={viewCreationRequest}
            navigationViewKeys={navigationKeys}
            operational={workspaceIsNavigationView}
            views={views}
            viewKey={workspaceViewKey}
            onBack={() =>
              navigate(
                workspaceViewKey ? { page: "views" } : { page: "more" },
                true,
              )
            }
            onOpenTask={(task, occurrence, order) =>
              navigate({ page: "task", id: task.id, occurrence }, false, order)
            }
            onSearch={() =>
              navigate(
                homeKey === SEARCH_NAVIGATION_KEY
                  ? { page: "home" }
                  : { page: "search" },
              )
            }
            onOpenView={(view) =>
              navigate(
                view.key === homeKey
                  ? { page: "home" }
                  : { page: "views", key: view.key },
              )
            }
            onOpenScratchpad={() =>
              navigate(
                homeKey === SCRATCHPAD_NAVIGATION_KEY
                  ? { page: "home" }
                  : { page: "scratchpad" },
              )
            }
            onToggleNavigationView={toggleNavigationView}
            onMoveNavigationView={moveNavigationView}
            onViewsChanged={refreshViews}
          />
        ) : null}
      </main>
      {route.page === "task" ? (
        <aside
          className="detail-inspector"
          aria-label={t({ message: "Task details" })}
          tabIndex={-1}
          ref={detailRef}
        >
          <CollectionAvailability
            onSettings={() => navigate({ page: "more", section: "collection" })}
          />
          {discoveryNotice}
          <TaskScreen
            id={route.id}
            occurrenceDate={route.occurrence}
            taskOrder={taskOrder}
            onNavigate={(target, order) =>
              navigate({ page: "task", ...target }, true, order)
            }
            onBack={() => {
              if (window.history.state?.taskPanel) window.history.back();
              else navigate(workspaceRoute, true);
            }}
            onMaterialized={(task) =>
              navigate({ page: "task", id: task.id }, true)
            }
          />
        </aside>
      ) : null}
      {showBottomNavigation ? (
        <nav
          className={`bottom-navigation items-${Math.min(navigationKeys.length, 2) + 2}`}
          aria-label={t({ message: "Primary" })}
        >
          <Navigation
            active={activePage}
            collectionUi={collectionUi}
            homeKey={homeKey}
            mode="mobile"
            navigationKeys={navigationKeys}
            views={views ?? []}
            onNavigate={navigate}
          />
        </nav>
      ) : null}
      {route.page !== "task" && showGlobalCaptureFab ? (
        <CaptureFab
          aria-keyshortcuts="Control+N Meta+N"
          aria-label={translate({ message: "New task" })}
          onClick={() => setCaptureOpen(true)}
        />
      ) : null}
      <KeyboardLayer
        homeKey={homeKey}
        navigate={navigate}
        navigationKeys={navigationKeys}
        newTask={openCapture}
        toggleSidebar={toggleSidebar}
        paletteRequest={paletteRequest}
        route={route}
        views={views ?? []}
      />
      <GlobalTaskCapture
        onAdded={reportAdded}
        open={captureOpen}
        onClose={closeCapture}
        onOpenTask={(task) => navigate({ page: "task", id: task.id })}
      />
      <TaskAddedNotice
        repository={repository}
        onUndo={(task) => deleteTask(task.id)}
        task={!pendingDeletion && !deletionError ? addedTask : undefined}
        onDismiss={() => setAddedNotice(undefined)}
        onOpen={(task) => navigate({ page: "task", id: task.id })}
        aboveMobileControls={
          route.page !== "task" &&
          (showBottomNavigation || showGlobalCaptureFab)
        }
      />
      <UndoFeedback
        aboveMobileControls={
          route.page !== "task" &&
          (showBottomNavigation || showGlobalCaptureFab)
        }
        paused={Boolean(pendingDeletion)}
        repository={repository}
      />
      <TaskCompletedNotice
        completion={completedNotice?.completion}
        aboveMobileControls={
          route.page !== "task" &&
          (showBottomNavigation || showGlobalCaptureFab)
        }
        onDismiss={dismissCompleted}
        onUndo={async (completion) => {
          await undoCompletion(completion);
          if (completionUndo.current) forgetUndo(completionUndo.current);
        }}
      />
      <FeedbackNotice>
        <DeletionFeedback
          aboveMobileControls={
            route.page !== "task" &&
            (showBottomNavigation || showGlobalCaptureFab)
          }
          error={deletionError}
          pendingDeletion={pendingDeletion}
          onRetry={retryTaskDeletion}
          onUndo={undoTaskDeletion}
        />
      </FeedbackNotice>
    </div>
  );
  return (
    <WorkspaceFeedback
      aboveMobileControls={
        route.page !== "task" && (showBottomNavigation || showGlobalCaptureFab)
      }
    >
      <CollectionWriteStatus
        repository={repository}
        connection={connection}
        onReview={(target) => {
          // An editor already showing this record presents its own resolution.
          if (requestRecordWriteReview(target)) return;
          navigate(
            target.kind === "task"
              ? { page: "task", id: target.id }
              : target.kind === "source"
                ? { page: "views" }
                : { page: "scratchpad" },
          );
        }}
      >
        <TaskCompletionReportContext.Provider value={reportCompleted}>
          <TaskSelectionProvider navigationKey={JSON.stringify(route)}>
            {shell}
          </TaskSelectionProvider>
        </TaskCompletionReportContext.Provider>
      </CollectionWriteStatus>
    </WorkspaceFeedback>
  );
}

export function ViewDiscoveryNotice({
  outcome,
  refreshing,
  onRetry,
  onCreate,
  onStarterViewsAdded,
}: {
  outcome: "loading" | "ok" | "empty" | "error";
  refreshing: boolean;
  onRetry(): void;
  onCreate(): void;
  /** Present only where the person can explicitly add the starter views. */
  onStarterViewsAdded?(): Promise<void>;
}) {
  const waitingForComputer =
    useContext(ConnectionNoticeContext) === "waiting_for_computer";
  if (waitingForComputer && outcome === "error") return null;
  if (outcome === "empty" && onStarterViewsAdded)
    return (
      <EmptyViewsNotice
        refreshing={refreshing}
        onCreate={onCreate}
        onStarterViewsAdded={onStarterViewsAdded}
      />
    );
  if (outcome !== "error" && outcome !== "empty") return null;
  return (
    <section
      className="view-discovery-notice"
      aria-label={translate({ message: "Views availability" })}
      aria-busy={refreshing}
    >
      <p role={outcome === "error" ? "alert" : "status"}>
        {outcome === "error"
          ? translate({ message: "Couldn't load your views." })
          : translate({ message: "No views yet." })}
      </p>
      <button
        className="text-action"
        type="button"
        disabled={refreshing}
        onClick={outcome === "error" ? onRetry : onCreate}
      >
        {outcome === "error"
          ? refreshing
            ? translate({ message: "Retrying…" })
            : translate({ message: "Retry" })
          : translate({ message: "Create a view" })}
      </button>
    </section>
  );
}

function EmptyViewsNotice({
  refreshing,
  onCreate,
  onStarterViewsAdded,
}: {
  refreshing: boolean;
  onCreate(): void;
  onStarterViewsAdded(): Promise<void>;
}) {
  const { add, adding, error } = useAddStarterViews(onStarterViewsAdded);
  return (
    <section
      className="view-discovery-notice"
      aria-label={translate({ message: "Views availability" })}
      aria-busy={refreshing || adding}
    >
      <p role="status">
        <Trans>No views yet.</Trans>
      </p>
      <button
        className="text-action"
        type="button"
        disabled={refreshing || adding}
        onClick={() => void add()}
      >
        {adding
          ? translate({ message: "Adding starter views…" })
          : translate({ message: "Add starter views" })}
      </button>
      <button
        className="text-action"
        type="button"
        disabled={refreshing || adding}
        onClick={onCreate}
      >
        <Trans>Create a view</Trans>
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function SidebarProjects({ projects }: { projects: ProjectShortcut[] }) {
  const { t } = useLingui();
  if (!projects.length) return null;
  return (
    <div
      aria-label={t`Busiest projects`}
      className="navigation-project-section"
      role="group"
    >
      {projects.map(({ label, count }) => (
        <button
          key={label}
          title={label}
          type="button"
          onClick={() => requestProjectJump(label)}
        >
          <Folder aria-hidden="true" size={15} strokeWidth={1.7} />
          <span>{label}</span>
          <small>{count}</small>
        </button>
      ))}
    </div>
  );
}

const UNDO_NOTICE_MS = 4000;

/** Ctrl or Cmd+Z reverses the latest edit once its toast has gone. */
function UndoFeedback({
  aboveMobileControls,
  paused,
  repository,
}: {
  aboveMobileControls: boolean;
  paused: boolean;
  repository: unknown;
}) {
  const { t } = useLingui();
  const [message, setMessage] = useState("");
  useEffect(() => clearUndoHistory, [repository]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), UNDO_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (paused) return;
    const undoShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() !== "z" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.defaultPrevented ||
        isEditableTarget(event.target)
      )
        return;
      const entry = takeUndo();
      if (!entry) return;
      event.preventDefault();
      const { label } = entry;
      void entry.run().then(
        () => setMessage(t`Undid change to “${label}”`),
        () => setMessage(t`Couldn’t undo. Try again.`),
      );
    };
    window.addEventListener("keydown", undoShortcut);
    return () => window.removeEventListener("keydown", undoShortcut);
  }, [paused, t]);
  if (!message) return null;
  return (
    <FeedbackNotice>
      <div
        className={`undo-toast${aboveMobileControls ? " is-above-mobile-controls" : ""}`}
        role="status"
      >
        <span>{message}</span>
      </div>
    </FeedbackNotice>
  );
}

export function DeletionFeedback({
  aboveMobileControls = false,
  error,
  pendingDeletion,
  onRetry,
  onUndo,
}: {
  aboveMobileControls?: boolean;
  error: OperationalError | null;
  pendingDeletion: {
    id: string;
    title: string;
    ids?: string[];
    outcomeUnknown?: boolean;
  } | null;
  onRetry(): Promise<void>;
  onUndo(): Promise<void>;
}) {
  const { t } = useLingui();
  useEffect(() => {
    if (!pendingDeletion || pendingDeletion.outcomeUnknown) return;
    const undoShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() !== "z" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        isEditableTarget(event.target)
      )
        return;
      event.preventDefault();
      void onUndo().catch(() => undefined);
    };
    window.addEventListener("keydown", undoShortcut);
    return () => window.removeEventListener("keydown", undoShortcut);
  }, [onUndo, pendingDeletion]);

  if (error)
    return (
      <DeletionRecoveryNotice
        aboveMobileControls={aboveMobileControls}
        error={error}
        outcomeUnknown={pendingDeletion?.outcomeUnknown ?? false}
        title={pendingDeletion?.title}
        onRetry={pendingDeletion ? onRetry : undefined}
        onUndo={pendingDeletion ? onUndo : undefined}
      />
    );
  if (!pendingDeletion) return null;
  const positionClass = aboveMobileControls ? " is-above-mobile-controls" : "";
  return (
    <>
      <p aria-atomic="true" className="visually-hidden" role="status">
        {pendingDeletion.ids && pendingDeletion.ids.length > 1
          ? t`${pendingDeletion.ids.length} tasks scheduled for deletion. Undo is available for 30 seconds.`
          : t`Deleted “${pendingDeletion.title}”. Undo is available for 30 seconds.`}
      </p>
      <div className={`undo-toast${positionClass}`}>
        <span>
          {pendingDeletion.ids && pendingDeletion.ids.length > 1
            ? t`${pendingDeletion.ids.length} tasks scheduled for deletion`
            : t`Deleted “${pendingDeletion.title}”`}
        </span>
        <button
          aria-keyshortcuts="Control+Z Meta+Z"
          type="button"
          onClick={() => void onUndo().catch(() => undefined)}
        >
          <Trans>Undo</Trans>
        </button>
      </div>
    </>
  );
}

function DeletionRecoveryNotice({
  aboveMobileControls,
  error,
  outcomeUnknown,
  title,
  onRetry,
  onUndo,
}: {
  aboveMobileControls: boolean;
  error: OperationalError;
  outcomeUnknown: boolean;
  title?: string;
  onRetry?: () => Promise<void>;
  onUndo?: () => Promise<void>;
}) {
  const { t } = useLingui();
  const headingId = useId();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const positionClass = aboveMobileControls ? " is-above-mobile-controls" : "";
  return (
    <section
      aria-labelledby={headingId}
      className={`deletion-recovery-notice${positionClass}`}
    >
      <header>
        <h2 id={headingId}>
          {outcomeUnknown
            ? t({ message: "Deletion needs review" })
            : t({ message: "Deletion waiting" })}
        </h2>
        {title ? (
          <p>
            {outcomeUnknown
              ? t`TaskNotes could not confirm whether “${title}” was deleted.`
              : t`“${title}” is still in the collection.`}
          </p>
        ) : null}
      </header>
      <OperationErrorNotice
        action={t({ message: "The deletion" })}
        message={error}
        recovery={
          onRetry
            ? outcomeUnknown
              ? t({
                  message:
                    "Retry checks the saved request without sending a new deletion. Discard requires confirmation and disconnects this collection.",
                })
              : t({ message: "Retry, or undo to restore the task here." })
            : t({ message: "The task remains in the collection. Try again." })
        }
      />
      {onRetry && onUndo ? (
        <div className="deletion-recovery-actions">
          <button
            className="retry-deletion-action"
            type="button"
            onClick={() => void onRetry().catch(() => undefined)}
          >
            <Trans>Retry</Trans>
          </button>
          {outcomeUnknown && confirmDiscard ? (
            <>
              <p>
                <Trans>
                  Discarding removes all saved recovery and disconnects this
                  collection. It does not reverse a deletion that may have
                  completed.
                </Trans>
              </p>
              <button
                type="button"
                onClick={() => void onUndo().catch(() => undefined)}
              >
                <Trans>Confirm discard and disconnect</Trans>
              </button>
              <button type="button" onClick={() => setConfirmDiscard(false)}>
                <Trans>Keep saved recovery</Trans>
              </button>
            </>
          ) : (
            <button
              aria-keyshortcuts={
                outcomeUnknown ? undefined : "Control+Z Meta+Z"
              }
              type="button"
              onClick={() =>
                outcomeUnknown
                  ? setConfirmDiscard(true)
                  : void onUndo().catch(() => undefined)
              }
            >
              {outcomeUnknown
                ? t({ message: "Discard recovery" })
                : t({ message: "Undo" })}
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function StorageErrorScreen({
  changeCollection,
  error,
  reauthorizeCurrentCollection,
  retry,
}: {
  changeCollection(): void;
  error: Error | null;
  reauthorizeCurrentCollection(): void;
  retry(): void;
}) {
  useI18n();
  const authorizationExpired = isAuthorizationError(error);
  return (
    <main className="opening-screen storage-error">
      <img alt="" src={tasknotesMarkUrl} />
      <h1>
        {authorizationExpired
          ? translate({ message: "Review TaskNotes’ access" })
          : translate({ message: "TaskNotes could not open." })}
      </h1>
      <p>
        {authorizationExpired
          ? translate({
              message:
                "TaskNotes needs your approval in mdbase again before it can open this collection.",
            })
          : translate({ message: "The collection is unavailable right now." })}
      </p>
      <div className="welcome-actions">
        {authorizationExpired ? (
          <button
            className="outline-action"
            type="button"
            onClick={reauthorizeCurrentCollection}
          >
            <Trans>Review access</Trans>
          </button>
        ) : (
          <button className="outline-action" type="button" onClick={retry}>
            <Trans>Try again</Trans>
          </button>
        )}
        <button
          className="text-action"
          type="button"
          onClick={changeCollection}
        >
          <Trans>Choose a different collection</Trans>
        </button>
      </div>
    </main>
  );
}

function HomeViewLoading() {
  return (
    <section
      aria-busy="true"
      aria-labelledby="home-view-loading-title"
      className="screen views-screen view-detail"
    >
      <header className="view-header operational">
        <div>
          <h1 id="home-view-loading-title">
            <Trans>Opening your view</Trans>
          </h1>
          <small>
            <Trans>Restoring your home view</Trans>
          </small>
        </div>
      </header>
      <LoadingRows count={6} />
    </section>
  );
}

function MenuCollectionItem({
  collectionUi,
  onChoose,
}: {
  collectionUi: CollectionUiOptions;
  onChoose(): void;
}) {
  const { view } = useCollectionUi(collectionUi);
  const name = view.current?.name;
  return (
    <button
      className="navigation-menu-collection"
      role="menuitem"
      type="button"
      onClick={onChoose}
    >
      <Library aria-hidden="true" size={19} strokeWidth={1.7} />
      <span>
        {name ? <strong>{name}</strong> : null}
        <small>
          <Trans>Switch collection</Trans>
        </small>
      </span>
    </button>
  );
}

export function Navigation({
  active,
  collectionUi,
  homeKey,
  mode,
  navigationKeys,
  views,
  onNavigate,
  onMove,
  onCommands,
  todayCounts,
  projects = [],
}: {
  active: string;
  /** Phones reach the collection from More; the desktop rail has its own switcher. */
  collectionUi?: CollectionUiOptions | null;
  homeKey?: string;
  mode: "desktop" | "mobile";
  navigationKeys: string[];
  views: TaskView[];
  onNavigate(route: Route): void;
  onMove?(key: string, direction: -1 | 1): void;
  onCommands?(): void;
  todayCounts?: TodayTaskCounts | null;
  projects?: ProjectShortcut[];
}) {
  const { t } = useLingui();
  const navigationEntries: {
    key: string;
    navigationKey: string;
    label: string;
    icon: LucideIcon;
    route: Route;
    shortcut?: string;
    today?: boolean;
  }[] = [];
  for (const key of navigationKeys) {
    if (key === SCRATCHPAD_NAVIGATION_KEY) {
      navigationEntries.push({
        shortcut: "g s",
        key: "scratchpad",
        navigationKey: key,
        label: t({ message: "Scratchpad" }),
        icon: FilePenLine,
        route: key === homeKey ? { page: "home" } : { page: "scratchpad" },
      });
      continue;
    }
    if (key === SEARCH_NAVIGATION_KEY) {
      navigationEntries.push({
        shortcut: "/",
        key: "search",
        navigationKey: key,
        label: t({ message: "Search" }),
        icon: Search,
        route: key === homeKey ? { page: "home" } : { page: "search" },
      });
      continue;
    }
    const view = views.find((candidate) => candidate.key === key);
    if (view)
      navigationEntries.push({
        shortcut: viewNavigationShortcut(view),
        today: starterViewKind(view) === "today",
        key: `view:${view.key}`,
        navigationKey: key,
        label: view.name,
        icon: taskViewIcon(view),
        route:
          view.key === homeKey
            ? { page: "home" }
            : { page: "views", key: view.key },
      });
  }
  const reorder = useSidebarReorder(
    navigationEntries.map((entry) => entry.navigationKey),
    mode === "desktop" ? onMove : undefined,
  );
  const visibleViews = navigationEntries.slice(0, 3);
  const additionalViews = navigationEntries.slice(visibleViews.length);
  const hiddenNavigationViewActive = additionalViews.some(
    (view) => active === view.key,
  );
  const items = visibleViews;
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useOverlay({
    open: Boolean(menuPosition),
    rootRef: menuRef,
    returnFocusRef: triggerRef,
    dismissOnTab: "always",
    onDismiss: closeMenu,
    initialFocus: () =>
      menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']") ??
      null,
  });
  const exitingMenu = useExitingValue(menuPosition);
  const shownMenuPosition = exitingMenu.value;
  const menuPresent = usePresence(
    Boolean(menuPosition),
    menuRef,
    exitingMenu.clear,
  );
  useEffect(() => {
    if (!menuPosition) return;
    window.addEventListener("resize", closeMenu);
    return () => window.removeEventListener("resize", closeMenu);
  }, [menuPosition]);

  function openMenu() {
    if (menuPosition) {
      closeMenu();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    const width = Math.min(236, innerWidth - 16);
    const height = Math.min(
      (additionalViews.length + (collectionUi ? 3 : 2)) * 46 + 16,
      innerHeight - 96,
    );
    const left =
      mode === "mobile"
        ? Math.max(
            8,
            Math.min(
              (rect?.left ?? innerWidth / 2) +
                (rect?.width ?? 0) / 2 -
                width / 2,
              innerWidth - width - 8,
            ),
          )
        : Math.min((rect?.right ?? 190) + 8, innerWidth - width - 8);
    const top =
      mode === "mobile"
        ? Math.max(8, (rect?.top ?? innerHeight) - height - 8)
        : Math.max(8, Math.min(rect?.top ?? 80, innerHeight - height - 8));
    setMenuPosition({ left, top });
  }

  function closeMenu() {
    setMenuPosition(null);
  }

  function choose(route: Route) {
    closeMenu();
    onNavigate(route);
  }

  function renderDestination(entry: (typeof navigationEntries)[number]) {
    const {
      key,
      navigationKey,
      label,
      icon: Icon,
      route,
      shortcut,
      today,
    } = entry;
    const counts = mode === "desktop" && today ? todayCounts : null;
    const accessibleLabel = counts
      ? counts.overdue
        ? t`${label}, ${countLabel(counts.total, "task")}, ${counts.overdue} overdue`
        : t`${label}, ${countLabel(counts.total, "task")}`
      : label;
    return (
      <button
        {...reorder.itemProps(navigationKey, label)}
        aria-label={accessibleLabel}
        aria-current={active === key ? "page" : undefined}
        className={active === key ? "is-active" : undefined}
        key={key}
        title={
          mode === "desktop"
            ? shortcut
              ? `${accessibleLabel} (${shortcut})`
              : accessibleLabel
            : undefined
        }
        type="button"
        onClick={() => onNavigate(route)}
      >
        <Icon aria-hidden="true" size={22} strokeWidth={1.7} />
        <span>{label}</span>
        {mode === "desktop" && today ? (
          <small
            aria-hidden="true"
            className={`navigation-count${counts ? "" : " is-unknown"}`}
          >
            {counts?.overdue ? <ClockAlert size={13} /> : null}
            {counts?.total ?? "0"}
          </small>
        ) : null}
      </button>
    );
  }

  return (
    <>
      {items.map(renderDestination)}
      {mode === "desktop" ? (
        <>
          <div
            aria-label={t({ message: "Views" })}
            className="navigation-view-section"
            role="group"
          >
            {additionalViews.map(renderDestination)}
          </div>
          <SidebarProjects projects={projects} />
        </>
      ) : (
        <>
          <button
            aria-controls={menuPosition ? menuId : undefined}
            aria-current={
              active === "views" ||
              active === "more" ||
              hiddenNavigationViewActive
                ? "page"
                : undefined
            }
            aria-expanded={Boolean(menuPosition)}
            aria-haspopup="menu"
            className={
              active === "views" ||
              active === "more" ||
              hiddenNavigationViewActive
                ? "is-active"
                : undefined
            }
            ref={triggerRef}
            type="button"
            onClick={openMenu}
          >
            <Ellipsis aria-hidden="true" size={22} strokeWidth={1.7} />
            <span>
              <Trans>More</Trans>
            </span>
          </button>
          {menuPresent && shownMenuPosition
            ? createPortal(
                <div
                  aria-hidden={menuPosition ? undefined : true}
                  aria-label={t({ message: "More" })}
                  className="navigation-views-menu"
                  data-state={menuPosition ? "open" : "closed"}
                  id={menuId}
                  inert={!menuPosition}
                  ref={menuRef}
                  role="menu"
                  onKeyDown={(event) => moveMenuFocus(event, menuRef.current)}
                  style={shownMenuPosition}
                >
                  {collectionUi ? (
                    <>
                      <MenuCollectionItem
                        collectionUi={collectionUi}
                        onChoose={() =>
                          choose({ page: "more", section: "collection" })
                        }
                      />
                      <hr />
                    </>
                  ) : null}
                  {additionalViews.map((view) => {
                    const Icon = view.icon;
                    return (
                      <button
                        aria-current={active === view.key ? "page" : undefined}
                        key={view.key}
                        role="menuitem"
                        type="button"
                        onClick={() => choose(view.route)}
                      >
                        <Icon aria-hidden="true" size={19} strokeWidth={1.7} />
                        <span>{view.label}</span>
                      </button>
                    );
                  })}
                  {additionalViews.length ? <hr /> : null}
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => choose({ page: "views" })}
                  >
                    <Columns3 aria-hidden="true" size={19} strokeWidth={1.7} />
                    <span>
                      <Trans>Manage views</Trans>
                    </span>
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => choose({ page: "more" })}
                  >
                    <Settings aria-hidden="true" size={19} strokeWidth={1.7} />
                    <span>
                      <Trans>Settings</Trans>
                    </span>
                  </button>
                </div>,
                document.body,
              )
            : null}
        </>
      )}
      {mode === "desktop" ? (
        <p aria-live="polite" className="visually-hidden">
          {reorder.announcement}
        </p>
      ) : null}
      {mode === "desktop" ? (
        <div
          aria-label={translate({ message: "Manage" })}
          className="navigation-utility"
          role="group"
        >
          {onCommands ? (
            <button
              aria-label={t({ message: "Commands" })}
              aria-keyshortcuts="Control+K Meta+K"
              className="navigation-commands"
              title={translate`Commands (${shortcutLabel("K")})`}
              type="button"
              onClick={onCommands}
            >
              <Command aria-hidden="true" size={20} strokeWidth={1.7} />
              <span>
                <Trans>Commands</Trans>
              </span>
              {isApplePlatform() ? <kbd>{shortcutLabel("K")}</kbd> : null}
            </button>
          ) : null}
          <button
            aria-current={active === "views" ? "page" : undefined}
            className={active === "views" ? "is-active" : undefined}
            aria-label={t({ message: "Manage views" })}
            title={t({ message: "Manage views" })}
            type="button"
            onClick={() => onNavigate({ page: "views" })}
          >
            <Columns3 aria-hidden="true" size={20} strokeWidth={1.7} />
            <span>
              <Trans>Manage views</Trans>
            </span>
          </button>
          <button
            aria-current={active === "more" ? "page" : undefined}
            className={active === "more" ? "is-active" : undefined}
            aria-label={t({ message: "Settings" })}
            title={t({ message: "Settings" })}
            type="button"
            onClick={() => onNavigate({ page: "more" })}
          >
            <Settings aria-hidden="true" size={20} strokeWidth={1.7} />
            <span>
              <Trans>Settings</Trans>
            </span>
          </button>
        </div>
      ) : null}
    </>
  );
}
