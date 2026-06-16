<script lang="ts" setup>
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Save,
  Sparkles,
} from '@lucide/vue';
import { computed, onMounted, reactive, ref } from 'vue';

import {
  type OrganizationRunResponse,
  type SettingsResponse,
  sendExtensionMessage,
} from '@/utils/messages';
import { DEFAULT_MODEL } from '@/utils/settings';

const settings = reactive({
  apiKey: '',
  model: DEFAULT_MODEL,
});

const isLoaded = ref(false);
const isSaving = ref(false);
const isGenerating = ref(false);
const isKeyVisible = ref(false);
const statusMessage = ref('');
const errorMessage = ref('');
const applyResult = ref<OrganizationRunResponse | null>(null);

const canOrganize = computed(() => Boolean(settings.apiKey.trim()) && !isGenerating.value);

onMounted(() => {
  void loadSettings();
});

async function loadSettings(): Promise<void> {
  await runTask(async () => {
    const response = await sendExtensionMessage<SettingsResponse>({ type: 'settings:get' });
    settings.apiKey = response.settings.apiKey;
    settings.model = response.settings.model;
    isLoaded.value = true;
  });
}

async function saveSettings(): Promise<void> {
  isSaving.value = true;
  await runTask(async () => {
    const response = await sendExtensionMessage<SettingsResponse>({
      type: 'settings:save',
      settings: {
        apiKey: settings.apiKey,
        model: settings.model,
      },
    });
    settings.apiKey = response.settings.apiKey;
    settings.model = response.settings.model;
    statusMessage.value = 'Configurações salvas localmente.';
  });
  isSaving.value = false;
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

    <section class="panel settings-panel" aria-labelledby="settings-title">
      <div class="section-heading">
        <KeyRound :size="17" aria-hidden="true" />
        <h2 id="settings-title">OpenRouter</h2>
      </div>

      <form class="settings-form" @submit.prevent="saveSettings">
        <label class="field">
          <span>Chave da API</span>
          <div class="secret-input">
            <input
              v-model="settings.apiKey"
              :type="isKeyVisible ? 'text' : 'password'"
              autocomplete="off"
              placeholder="sk-or-v1..."
              :disabled="!isLoaded"
            />
            <button
              class="icon-button"
              type="button"
              :aria-label="isKeyVisible ? 'Ocultar chave da API' : 'Mostrar chave da API'"
              @click="isKeyVisible = !isKeyVisible"
            >
              <EyeOff v-if="isKeyVisible" :size="16" />
              <Eye v-else :size="16" />
            </button>
          </div>
        </label>

        <label class="field">
          <span>Modelo</span>
          <input v-model="settings.model" type="text" placeholder="openrouter/owl-alpha" :disabled="!isLoaded" />
        </label>

        <button class="button secondary" type="submit" :disabled="isSaving || !isLoaded">
          <LoaderCircle v-if="isSaving" class="spin" :size="16" aria-hidden="true" />
          <Save v-else :size="16" aria-hidden="true" />
          <span>{{ isSaving ? 'Salvando' : 'Salvar' }}</span>
        </button>
      </form>
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
