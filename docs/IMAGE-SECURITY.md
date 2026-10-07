# Аудит production образов

Дата: 7 октября 2026. Инструмент: Trivy 0.75.0, официальный release проверен по [GitHub](https://github.com/aquasecurity/trivy/releases/tag/v0.75.0). Аудит включает OS и runtime packages; не сканирует пользовательские данные или secrets. Кэш сканера — Docker volume вне checkout.

## Выполненные исправления

- Python prod runtime отделён от Poetry/dev dependencies; pip удалён из runtime.
- npm/npx/corepack удалены из Next standalone runtime; Node запускает server.js напрямую. Найденные HIGH в npm toolchain исчезли; frontend сохраняет MEDIUM finding, указанный в отчёте.
- Backup больше не использует PGDG/curl: клиент PostgreSQL 18 установлен из Alpine main.
- Для Python wheel auditwheel SBOM исключён только файл `auditwheel.cdx.json`: он описывает отсутствующие runtime инструменты сборки. Native-library SBOM и фактически установленные пакеты проверяются; vulnerability IDs/severity не подавляются. Списки фактических установленных runtime distributions проверены отдельно.
- Nonroot, cap_drop, read-only filesystem, закрытая сеть БД/Redis и отключённое публичное чтение метрик уменьшают доступную поверхность.

## Результат после смены runtime

Production backend/backup используют официальный `python:3.14.8-alpine3.24`. Locked зависимости собираются в отдельном Alpine stage; glibc virtualenv из Debian не переносится в musl. Backup устанавливает `postgresql18-client` 18.6-r0 из официального Alpine main. Developer image остаётся Debian; он не поставляется как production runtime.

| Образ ARM64 | HIGH | CRITICAL | MEDIUM |
| --- | --- | --- | --- |
| backend | 0 | 0 | 0 |
| frontend | 0 | 0 | 0 |
| backup | 0 | 0 | 0 |

Release gate проходит без исключений CVE/severity. Последнее MEDIUM (CVE-2026-85091, zlib 1.3.2-r0) устранено обновлением до 1.3.2-r1. Наличие ревизии подтверждено `apk policy zlib` через официальный https://dl-cdn.alpinelinux.org/alpine/v3.24/main; Dockerfile требует как минимум эту ревизию. По текущему скану findings всех severity отсутствуют. Это результат advisory базы на дату сканирования, не гарантия отсутствия неизвестных уязвимостей.

Совместимость подтверждена полным набором 66 тестов, import/readiness реальных зависимостей и encrypted backup/restore с deletion replay. Дополнительно backup/restore прошёл под штатным непривилегированным пользователем с read-only root filesystem и приватным writable tmpfs. Реальных запросов Instagram нет.

Ранее Debian slim дал 44/47 HIGH, Bookworm — больше findings, включая CRITICAL. Эти кандидаты отклонены. Альтернативные отчёты отражают исследование, а не поставляемые образы. Текущие отчёты: `reports/backend-image-audit.json`, `reports/frontend-image-audit.json`, `reports/backup-image-audit.json`.

Официальные источники: [Docker Python tags](https://github.com/docker-library/official-images/blob/master/library/python), [Alpine PostgreSQL client](https://pkgs.alpinelinux.org/package/v3.24/main/aarch64/postgresql18-client). Перед release повторить аудит свежесобранного образа на целевой архитектуре.

## Повторение и gate

```sh
make prod-build
make image-audit
```

Сканирование всегда сохраняет JSON. `check-image-audits.py` завершается ненулевым кодом при HIGH/CRITICAL; CI и deploy используют этот gate. Игнорировать эти findings ради зелёного CI не следует. В этой работе публичное развёртывание не выполнялось.


Dev Garage v2.4.1 проверен отдельным image scan (`garage-dev-image-audit.json`), но Trivy не обнаружил в статическом image OS/language package inventory. Этот результат не считается полноценным аудитом Rust/native dependencies и не включён в утверждение об отсутствии findings в трёх production images. Production Garage не поставляется.
