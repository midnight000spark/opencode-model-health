# v0.1.0-beta.1 — public beta

TUI-плагин для OpenCode V2: по команде проверяет, какие модели провайдера реально
отвечают, и показывает «что поднято, что упало» в одном диалоге.

Это **beta**: поведение и интерфейс могут меняться. Плагин проверяет доступность
через plain OpenAI Chat Completions, а не через все возможные протоколы и
настройки OpenCode.

## Установка

Требуются OpenCode V2 и Bun.

```sh
git clone https://github.com/midnight000spark/opencode-model-health.git
cd opencode-model-health
bun install
```

Подключение через `cli.json` (путь к каталогу, где лежит `tui.ts`):

```jsonc
{
  "plugins": [
    {
      "package": "/home/you/src/opencode-model-health",
      "options": { "provider": "reformboss" }
    }
  ]
}
```

`provider` — id твоего провайдера из `opencode.json`; `reformboss` — пример.
После правки выполни `/reload` в TUI.

Альтернатива без опций — симлинк:

```sh
ln -sfn "$PWD" ~/.config/opencode/plugins/model-health
```

## Использование

- палитра команд: `Models: health check`;
- слэш-команда: `/models-health`;
- клавиши: `<leader>mh` (лидер — как задан в `cli.json`).

В диалоге: `Enter` — детали модели, `Ctrl+o` — перепроверить, `Ctrl+y` —
переключить «только текст» ↔ «все», `Esc` — закрыть или отменить идущую
проверку.

## Важно: реальные запросы и стоимость

На каждую chat-модель отправляется реальный `POST /chat/completions` с
`max_tokens: 32`. Провайдер может тарифицировать эти запросы и учитывать их в
rate limit. `mode` управляет только отображением: VL/omni-модели тоже
проверяются. `Ctrl+o` запускает повторный скан, минуя кэш.

## Границы

- Probe говорит только на plain OpenAI Chat Completions; provider-level
  `headers`, `body` и `compatibility` не применяются.
- Модели, доступные только через `openai/responses`, показываются как
  `➖ не проверяется`.
- Запросы идут с машины, где запущен TUI; endpoint должен быть доступен с неё.
- Переключить текущую модель сессии плагин не может.

## Проверка

- `bun run typecheck` — чисто;
- `bun test` — 162 теста, 0 падений;
- CI GitHub Actions — успешно.

## Обратная связь

Issues и предложения:
https://github.com/midnight000spark/opencode-model-health/issues

Для баг-репорта приложи версию OpenCode, id провайдера, режим (`text`/`all`) и
текст ошибки без ключей и персональных данных.