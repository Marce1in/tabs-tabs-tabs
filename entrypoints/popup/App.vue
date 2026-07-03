<script lang="ts" setup>
import {
  Check,
  LoaderCircle,
  LogOut,
  Sparkles,
} from '@lucide/vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';

import {
  type AuthStatusResponse,
  type OrganizationRunResponse,
  type SyncStatusResponse,
  sendExtensionMessage,
} from '@/utils/messages';
import type { GitHubAuthState } from '@/utils/auth';

const isGenerating = ref(false);
const isSigningIn = ref(false);
const isAuthLoaded = ref(false);
const statusMessage = ref('');
const errorMessage = ref('');
const applyResult = ref<OrganizationRunResponse | null>(null);
const syncStatus = ref<SyncStatusResponse | null>(null);
const authState = ref<GitHubAuthState | null>(null);

const canOrganize = computed(() => Boolean(authState.value) && !isGenerating.value);
const syncStateLabel = computed(() => getSyncStateLabel(syncStatus.value?.state ?? 'idle'));
const syncSummary = computed(() => {
  const tabs = syncStatus.value?.globalTabs ?? 0;
  const devices = syncStatus.value?.connectedClients ?? 0;
  return `${formatSyncedTabCount(tabs)} · ${formatCount(devices, 'dispositivo', 'dispositivos')}`;
});
let syncStatusTimer: number | undefined;

onMounted(async () => {
  await loadAuthStatus();
  if (authState.value) await loadSyncStatus();

  syncStatusTimer = window.setInterval(() => {
    if (authState.value) void loadSyncStatus();
  }, 2500);
});

onUnmounted(() => {
  if (syncStatusTimer) window.clearInterval(syncStatusTimer);
});

async function loadAuthStatus(): Promise<void> {
  try {
    const response = await sendExtensionMessage<AuthStatusResponse>({ type: 'auth:status:get' });
    authState.value = response.auth;
  } catch {
    authState.value = null;
  } finally {
    isAuthLoaded.value = true;
  }
}

async function signInWithGitHub(): Promise<void> {
  isSigningIn.value = true;

  try {
    await runTask(async () => {
      const response = await sendExtensionMessage<AuthStatusResponse>({ type: 'auth:github:start' });
      authState.value = response.auth;
      statusMessage.value = 'GitHub conectado.';
      await loadSyncStatus();
    });
  } finally {
    isSigningIn.value = false;
  }
}

async function signOut(): Promise<void> {
  await runTask(async () => {
    const response = await sendExtensionMessage<AuthStatusResponse>({ type: 'auth:logout' });
    authState.value = response.auth;
    syncStatus.value = null;
    applyResult.value = null;
    statusMessage.value = 'GitHub desconectado.';
  });
}

async function organizeNow(): Promise<void> {
  isGenerating.value = true;
  applyResult.value = null;

  await runTask(async () => {
    applyResult.value = await sendExtensionMessage<OrganizationRunResponse>({ type: 'organize:run' });
    statusMessage.value = 'Abas organizadas.';
  });

  isGenerating.value = false;
}

async function loadSyncStatus(): Promise<void> {
  try {
    syncStatus.value = await sendExtensionMessage<SyncStatusResponse>({ type: 'sync:status:get' });
  } catch {
    syncStatus.value = {
      clientId: '',
      state: 'error',
      message: 'Não foi possível ler o status do sync.',
      globalTabs: 0,
      connectedClients: 0,
      lastSyncedAt: '',
    };
  }
}

async function runTask(task: () => Promise<void>): Promise<void> {
  errorMessage.value = '';

  try {
    await task();
  } catch (error) {
    errorMessage.value = getErrorMessage(error);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Algo deu errado.';
}

function getSyncStateLabel(state: SyncStatusResponse['state']): string {
  return {
    idle: 'Aguardando',
    connecting: 'Conectando',
    connected: 'Conectado',
    reconciling: 'Sincronizando',
    disconnected: 'Desconectado',
    error: 'Erro',
  }[state];
}

function formatSyncedTabCount(count: number): string {
  return `${formatCount(count, 'aba', 'abas')} sincronizada${count === 1 ? '' : 's'}`;
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
</script>

<template>
  <main class="shell" :aria-busy="!isAuthLoaded || isSigningIn || isGenerating">
    <header class="masthead" :class="{ 'auth-masthead': !authState }">
      <div>
        <h1>Tabs Tabs Tabs</h1>
      </div>
    </header>

    <section v-if="!isAuthLoaded" class="panel auth-panel auth-panel-loading" aria-label="Carregando">
      <LoaderCircle class="spin" :size="20" aria-hidden="true" />
    </section>

    <template v-else-if="!authState">
      <section class="panel auth-panel" aria-label="Login com GitHub">
        <button class="button github-login-button" type="button" :disabled="isSigningIn" @click="signInWithGitHub">
          <LoaderCircle v-if="isSigningIn" class="spin" :size="18" aria-hidden="true" />
          <svg
            v-else
            class="github-logo"
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 0C5.37 0 0 5.5 0 12.28c0 5.42 3.44 10.02 8.2 11.65.6.11.82-.27.82-.59 0-.29-.01-1.06-.02-2.08-3.34.74-4.04-1.65-4.04-1.65-.55-1.42-1.33-1.8-1.33-1.8-1.09-.76.08-.74.08-.74 1.2.09 1.84 1.27 1.84 1.27 1.07 1.87 2.81 1.33 3.5 1.02.11-.79.42-1.33.76-1.64-2.66-.31-5.46-1.36-5.46-6.07 0-1.34.47-2.43 1.24-3.29-.12-.31-.54-1.56.12-3.24 0 0 1.01-.33 3.3 1.26A11.24 11.24 0 0 1 12 5.95c1.02 0 2.05.14 3.01.41 2.29-1.59 3.3-1.26 3.3-1.26.66 1.68.24 2.93.12 3.24.77.86 1.24 1.95 1.24 3.29 0 4.72-2.8 5.75-5.47 6.06.43.38.81 1.13.81 2.28 0 1.64-.01 2.96-.01 3.37 0 .33.22.71.82.59A12.25 12.25 0 0 0 24 12.28C24 5.5 18.63 0 12 0Z"
            />
          </svg>
          <span>{{ isSigningIn ? 'Conectando ao GitHub' : 'Continuar com GitHub' }}</span>
        </button>
      </section>
    </template>

    <template v-else>
      <section class="panel settings-panel" aria-label="Usuário conectado">
        <div class="account-row">
          <img v-if="authState.avatarUrl" :src="authState.avatarUrl" alt="" />
          <div v-else class="avatar-fallback" aria-hidden="true">{{ authState.login.charAt(0).toUpperCase() }}</div>
          <strong>@{{ authState.login }}</strong>
          <button class="icon-button" type="button" aria-label="Sair do GitHub" @click="signOut">
            <LogOut :size="16" aria-hidden="true" />
          </button>
        </div>
      </section>

      <section class="panel sync-panel" aria-label="Tab Sync">
        <div class="sync-row" aria-live="polite">
          <span class="sync-state" :data-state="syncStatus?.state ?? 'idle'">
            <span aria-hidden="true"></span>
            {{ syncStateLabel }}
          </span>
          <span class="sync-summary">{{ syncSummary }}</span>
        </div>
      </section>

      <section class="actions-panel" aria-label="Agrupar abas">
        <button class="button primary" type="button" :disabled="!canOrganize" @click="organizeNow">
          <LoaderCircle v-if="isGenerating" class="spin" :size="18" aria-hidden="true" />
          <Sparkles v-else :size="18" aria-hidden="true" />
          <span>{{ isGenerating ? 'Organizando' : 'Agrupar abas' }}</span>
        </button>
      </section>

      <section v-if="applyResult" class="result" aria-live="polite">
        <Check :size="16" aria-hidden="true" />
        <span>
          Aplicou {{ applyResult.appliedGroups }} grupos em {{ applyResult.groupedTabs }} abas.
        </span>
      </section>
    </template>

    <p v-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}</p>
    <p v-else-if="statusMessage" class="notice success" aria-live="polite">{{ statusMessage }}</p>
  </main>
</template>
