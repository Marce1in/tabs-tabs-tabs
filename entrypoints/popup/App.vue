<script lang="ts" setup>
import {
  Check,
  LoaderCircle,
  LogIn,
  LogOut,
  RadioTower,
  Sparkles,
  UserRound,
} from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';

import {
  type AuthStatusResponse,
  type OrganizationRunResponse,
  type SyncStatusResponse,
  sendExtensionMessage,
} from '@/utils/messages';
import type { GitHubAuthState } from '@/utils/auth';

const isGenerating = ref(false);
const isSigningIn = ref(false);
const statusMessage = ref('');
const errorMessage = ref('');
const applyResult = ref<OrganizationRunResponse | null>(null);
const syncStatus = ref<SyncStatusResponse | null>(null);
const authState = ref<GitHubAuthState | null>(null);

const canOrganize = computed(() => Boolean(authState.value) && !isGenerating.value);
const canSync = computed(() => Boolean(authState.value));

onMounted(() => {
  void loadAuthStatus();
  void loadSyncStatus();
  window.setInterval(() => {
    void loadSyncStatus();
  }, 2500);
});

async function loadAuthStatus(): Promise<void> {
  try {
    const response = await sendExtensionMessage<AuthStatusResponse>({ type: 'auth:status:get' });
    authState.value = response.auth;
  } catch {
    authState.value = null;
  }
}

async function signInWithGitHub(): Promise<void> {
  isSigningIn.value = true;

  await runTask(async () => {
    const response = await sendExtensionMessage<AuthStatusResponse>({ type: 'auth:github:start' });
    authState.value = response.auth;
    statusMessage.value = 'GitHub conectado.';
    await loadSyncStatus();
  });

  isSigningIn.value = false;
}

async function signOut(): Promise<void> {
  await runTask(async () => {
    const response = await sendExtensionMessage<AuthStatusResponse>({ type: 'auth:logout' });
    authState.value = response.auth;
    statusMessage.value = 'GitHub desconectado.';
    await loadSyncStatus();
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
</script>

<template>
  <main class="shell" aria-busy="false">
    <header class="masthead">
      <div>
        <h1>Tabs Tabs Tabs</h1>
      </div>
    </header>

    <section class="panel settings-panel" aria-labelledby="account-title">
      <div class="section-heading">
        <UserRound :size="17" aria-hidden="true" />
        <h2 id="account-title">GitHub</h2>
      </div>

      <div v-if="authState" class="account-row">
        <img v-if="authState.avatarUrl" :src="authState.avatarUrl" alt="" />
        <div>
          <span>Conectado como</span>
          <strong>@{{ authState.login }}</strong>
        </div>
        <button class="icon-button" type="button" aria-label="Sair do GitHub" @click="signOut">
          <LogOut :size="16" aria-hidden="true" />
        </button>
      </div>

      <button v-else class="button secondary" type="button" :disabled="isSigningIn" @click="signInWithGitHub">
        <LoaderCircle v-if="isSigningIn" class="spin" :size="16" aria-hidden="true" />
        <LogIn v-else :size="16" aria-hidden="true" />
        <span>{{ isSigningIn ? 'Conectando' : 'Entrar com GitHub' }}</span>
      </button>
    </section>

    <section class="panel sync-panel" aria-labelledby="sync-title">
      <div class="section-heading">
        <RadioTower :size="17" aria-hidden="true" />
        <h2 id="sync-title">Tab Sync</h2>
      </div>

      <div class="sync-grid" aria-live="polite">
        <div>
          <span>Status</span>
          <strong>{{ canSync ? (syncStatus?.state ?? 'idle') : 'signed out' }}</strong>
        </div>
        <div>
          <span>Abas</span>
          <strong>{{ syncStatus?.globalTabs ?? 0 }}</strong>
        </div>
        <div>
          <span>Clientes</span>
          <strong>{{ syncStatus?.connectedClients ?? 0 }}</strong>
        </div>
      </div>
    </section>

    <section class="actions-panel" aria-label="Organizar agora">
      <button class="button primary" type="button" :disabled="!canOrganize" @click="organizeNow">
        <LoaderCircle v-if="isGenerating" class="spin" :size="18" aria-hidden="true" />
        <Sparkles v-else :size="18" aria-hidden="true" />
        <span>{{ isGenerating ? 'Organizando' : 'Organizar agora' }}</span>
      </button>
    </section>

    <p v-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}</p>
    <p v-else-if="statusMessage" class="notice success" aria-live="polite">{{ statusMessage }}</p>

    <section v-if="applyResult" class="result" aria-live="polite">
      <Check :size="16" aria-hidden="true" />
      <span>
        Aplicou {{ applyResult.appliedGroups }} grupos em {{ applyResult.groupedTabs }} abas.
      </span>
    </section>
  </main>
</template>
