import { TaskSelectionProvider } from "./task-selection";
import { useLingui as useI18n } from "@lingui/react";
import { useLingui } from "@lingui/react/macro";
import { Trans } from "@lingui/react/macro";
import { t as translate } from "@lingui/core/macro";
import {
  ClockAlert,
  PanelLeftClose,
  PanelLeftOpen,
  Columns3,
  Command,
  Ellipsis,
  FilePenLine,
  Library,
  Link2,
  Import,
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
import {
  onProjectJump,
  requestProjectJump,
  setFocusedProject,
  useFocusedProject,
} from "./project-jump";
import { useProjectShortcuts } from "./use-project-shortcuts";
import {
  clearUndoHistory,
  forgetUndo,
  onUndoNotice,
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
import { useNavigationTaskCounts } from "./use-navigation-task-counts";
import {
  readSidebarCollapsed,
  saveSidebarCollapsed,
} from "./sidebar-preferences";
import { starterViewKind } from "../domain/default-view-source";
import { viewNavigationShortcut } from "./palette-commands";
import { KeyboardLayer } from "./keyboard-layer";
import {
  focusRestoredTaskRow,
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
  const localScopeDescriptionId = useId();
  const keyboardOccluded = useKeyboardOcclusion();
  const todayCounts = useTodayTaskCounts();
  const navigationCounts = useNavigationTaskCounts();
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
  const {
    collectionUi,
    localCollection,
    changeCollection,
    reauthorizeCurrentCollection,
  } = useCollectionGate();
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
        const current = routeRef.current;
        if (key && !(current.page === "views" && current.key === key))
          navigate({ page: "views", key });
      }),
    [navigate, views],
  );
  const completionUndo = useRef<UndoEntry | undefined>(undefined);
  const undoCompletion = useCallback(
    async ({ task, occurrenceDate, advanced, completed }: TaskCompletion) => {
      const origin = routeRef.current;
      const reopened = await setTaskCompletion({
        id: task.id,
        occurrenceDate,
        completed: completed === false,
      });
      const { status } = task;
      if (advanced || reopened.status !== status)
        await updateTask(task.id, {
          ...advanced,
          ...(reopened.status !== status ? { status } : {}),
        });
      setCompletedNotice(undefined);
      if (routeRef.current === origin) focusRestoredTaskRow(task.id);
    },
    [setTaskCompletion, updateTask],
  );
  const reportCompleted = useCallback(
    (completion: TaskCompletion) => {
      setAddedNotice(undefined);
      setCompletedNotice({ completion, repository, route: routeRef.current });
      completionUndo.current = {
        label: completion.task.title,
        undoNotice:
          completion.completed === false
            ? translate`Completed “${completion.task.title}”`
            : translate`Reopened “${completion.task.title}”`,
        run: () => undoCompletion(completion),
      };
      rememberUndo(completionUndo.current);
    },
    [repository, undoCompletion],
  );
  const dismissCompleted = useCallback(() => setCompletedNotice(undefined), []);
  useEffect(
    () =>
      onUndoNotice(() => {
        setAddedNotice(undefined);
        setCompletedNotice(undefined);
      }),
    [],
  );
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
    route.page !== "task" && !(workspace.page === "home" && viewsLoading);
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
        ) : localCollection?.active ? (
          <div className="local-collection-control">
            <p id={localScopeDescriptionId}>
              <Trans>
                Saved in this browser. Clearing browser data removes local
                tasks.
              </Trans>
            </p>
            <button
              className="secondary-action local-collection-connect"
              type="button"
              aria-label={t`Connect collection`}
              aria-describedby={localScopeDescriptionId}
              title={t`Connect collection`}
              onClick={changeCollection}
            >
              <Link2
                className="local-collection-connect-icon"
                aria-hidden="true"
                size={20}
                strokeWidth={1.8}
              />
              <span>
                <Trans>Connect collection</Trans>
              </span>
            </button>
          </div>
        ) : null}
        {localCollection?.review ? (
          <button
            className="text-action"
            type="button"
            aria-label={t`Review local tasks`}
            title={t`Review local tasks`}
            onClick={localCollection.review}
          >
            <Import aria-hidden="true" size={20} strokeWidth={1.8} />
            <span>
              <Trans>Review local tasks</Trans>
            </span>
          </button>
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
          navigationCounts={navigationCounts}
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
            onManageViews={() => navigate({ page: "views" })}
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
            localCollection={!!localCollection?.active}
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
        hidden={Boolean(addedTask || completedNotice)}
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
  const focused = useFocusedProject();
  const tooltipId = useId();
  const [tooltip, setTooltip] = useState<{
    label: string;
    text: string;
    left: number;
    top?: number;
    bottom?: number;
    maxHeight?: number;
  } | null>(null);
  if (!projects.length) return null;
  return (
    <div
      aria-label={t`Busiest projects`}
      className="navigation-project-section"
      role="group"
    >
      {projects.map(({ label, count }) => {
        const accessibleLabel = t`${label}, ${countLabel(count, "task")}`;
        const words = label.trim().split(/\s+/u);
        const monogram = (
          words.length > 1
            ? words
                .slice(0, 2)
                .map((word) => Array.from(word)[0])
                .join("")
            : Array.from(label.trim()).slice(0, 2).join("")
        ).toLocaleUpperCase();
        const showTooltip = (button: HTMLButtonElement) => {
          const bounds = button.getBoundingClientRect();
          setTooltip({
            label,
            text: accessibleLabel,
            left: bounds.right + 8,
            top: bounds.top + bounds.height / 2,
          });
        };
        return (
          <button
            aria-label={accessibleLabel}
            aria-describedby={tooltip?.label === label ? tooltipId : undefined}
            aria-current={focused === label ? "page" : undefined}
            className={focused === label ? "is-active" : undefined}
            key={label}
            type="button"
            onFocus={(event) => showTooltip(event.currentTarget)}
            onBlur={() => setTooltip(null)}
            onMouseEnter={(event) => showTooltip(event.currentTarget)}
            onMouseLeave={(event) => {
              if (document.activeElement !== event.currentTarget)
                setTooltip(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setTooltip(null);
            }}
            onClick={() => requestProjectJump(label)}
          >
            <strong aria-hidden="true" className="project-monogram">
              {monogram}
            </strong>
            <span>{label}</span>
            <small aria-hidden="true">{count}</small>
          </button>
        );
      })}
      {tooltip
        ? createPortal(
            <div
              className="project-shortcut-tooltip"
              id={tooltipId}
              role="tooltip"
              style={{ left: tooltip.left, top: tooltip.top }}
            >
              {tooltip.text}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const UNDO_NOTICE_MS = 10000;

/** Confirms a quiet edit with Undo; Ctrl or Cmd+Z reverses it at any time. */
function UndoFeedback({
  aboveMobileControls,
  hidden,
  paused,
  repository,
}: {
  aboveMobileControls: boolean;
  hidden: boolean;
  paused: boolean;
  repository: unknown;
}) {
  const { t } = useLingui();
  const [notice, setNotice] = useState<{
    message: string;
    entry?: UndoEntry;
  }>();
  useEffect(() => clearUndoHistory, [repository]);
  useEffect(
    () =>
      onUndoNotice((entry) =>
        setNotice({ message: entry.notice ?? entry.label, entry }),
      ),
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), UNDO_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const undo = useCallback(
    (entry: UndoEntry) => {
      const { label } = entry;
      void entry.run().then(
        () =>
          setNotice({
            message: entry.undoNotice ?? t`Undid change to “${label}”`,
          }),
        () => setNotice({ message: t`Couldn’t undo. Try again.` }),
      );
    },
    [t],
  );
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
      undo(entry);
    };
    window.addEventListener("keydown", undoShortcut);
    return () => window.removeEventListener("keydown", undoShortcut);
  }, [paused, undo]);
  if (!notice || hidden) return null;
  const { entry, message } = notice;
  return (
    <FeedbackNotice>
      <div
        className={`undo-toast${aboveMobileControls ? " is-above-mobile-controls" : ""}`}
        role="status"
      >
        <span>{message}</span>
        {entry ? (
          <button
            type="button"
            onClick={() => {
              forgetUndo(entry);
              undo(entry);
            }}
          >
            {t`Undo`}
          </button>
        ) : null}
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

function MenuLocalCollectionItem({ onChoose }: { onChoose(): void }) {
  return (
    <button
      className="navigation-menu-collection"
      role="menuitem"
      type="button"
      onClick={onChoose}
    >
      <Library aria-hidden="true" size={19} strokeWidth={1.7} />
      <span>
        <strong>
          <Trans comment="Name of the collection kept in this browser before connecting">
            Local tasks
          </Trans>
        </strong>
        <small>
          <Trans>Saved in this browser</Trans>
        </small>
      </span>
    </button>
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
  localCollection = false,
  homeKey,
  mode,
  navigationKeys,
  views,
  onNavigate,
  onMove,
  onCommands,
  todayCounts,
  navigationCounts,
  projects = [],
}: {
  active: string;
  /** Phones reach the collection from More; the desktop rail has its own switcher. */
  collectionUi?: CollectionUiOptions | null;
  /** Local work before connecting: More names it and leads to Collection settings. */
  localCollection?: boolean;
  homeKey?: string;
  mode: "desktop" | "mobile";
  navigationKeys: string[];
  views: TaskView[];
  onNavigate(route: Route): void;
  onMove?(key: string, direction: -1 | 1): void;
  onCommands?(): void;
  todayCounts?: TodayTaskCounts | null;
  navigationCounts?: { inbox: number; upcoming: number } | null;
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
    kind?: ReturnType<typeof starterViewKind>;
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
        kind: starterViewKind(view),
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
    top?: number;
    bottom?: number;
    maxHeight?: number;
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
      (additionalViews.length + (collectionUi || localCollection ? 3 : 2)) *
        46 +
        16,
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
    if (mode === "mobile") {
      // Anchor the actual menu above More. Collection labels and enlarged text
      // can wrap, so an estimated row height cannot determine its top edge.
      const bottom = innerHeight - (rect?.top ?? innerHeight) + 8;
      setMenuPosition({
        left,
        bottom,
        maxHeight: Math.max(44, Math.min(520, innerHeight - bottom - 8)),
      });
    } else {
      const top = Math.max(
        8,
        Math.min(rect?.top ?? 80, innerHeight - height - 8),
      );
      setMenuPosition({ left, top });
    }
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
    const countKind = entry.kind;
    const counts =
      mode !== "desktop"
        ? null
        : today
          ? todayCounts
          : navigationCounts &&
              (countKind === "inbox" || countKind === "upcoming")
            ? { total: navigationCounts[countKind], overdue: 0 }
            : null;
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
        onClick={() => {
          setFocusedProject(null);
          onNavigate(route);
        }}
      >
        <Icon aria-hidden="true" size={22} strokeWidth={1.7} />
        <span>{label}</span>
        {mode === "desktop" && (today || counts) ? (
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
      {mode === "desktop" ? (
        <div className="navigation-destinations">
          {items.map(renderDestination)}
          <div
            aria-label={t({ message: "Views" })}
            className="navigation-view-section"
            role="group"
          >
            {additionalViews.map(renderDestination)}
          </div>
          <SidebarProjects projects={projects} />
        </div>
      ) : (
        <>
          {items.map(renderDestination)}
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
                  ) : localCollection ? (
                    <>
                      <MenuLocalCollectionItem
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
                      <Trans>Views</Trans>
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
          <button
            aria-current={active === "views" ? "page" : undefined}
            className={
              active === "views"
                ? "navigation-views is-active"
                : "navigation-views"
            }
            aria-label={t({ message: "Views" })}
            title={t({ message: "Views" })}
            type="button"
            onClick={() => onNavigate({ page: "views" })}
          >
            <Columns3 aria-hidden="true" size={20} strokeWidth={1.7} />
            <span>
              <Trans>Views</Trans>
            </span>
          </button>
          {onCommands ? (
            <button
              aria-label={t({ message: "Quick actions" })}
              aria-keyshortcuts="Control+K Meta+K"
              className="navigation-commands"
              title={translate`Quick actions (${shortcutLabel("K")})`}
              type="button"
              onClick={onCommands}
            >
              <Command aria-hidden="true" size={20} strokeWidth={1.7} />
              <span>
                <Trans>Quick actions</Trans>
              </span>
              {isApplePlatform() ? <kbd>{shortcutLabel("K")}</kbd> : null}
            </button>
          ) : null}
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
