# 工单 08：套餐用量文案对照表

上游 `providerUsage.*` 的值改回 Osuna 合并前的译法。来源列是取值的 Osuna 键（`usage.planUsage.*`，`timing.*Ago` 取 `usage.common.time.*`）；参数名随上游改（`ago`→`relativeTime`、`count`→`value`、`percent`→`percentage`）。阿拉伯语 `timing.*Ago` 的六个复数变体都写成同一个 Osuna 值。没有 Osuna 对应键的 `labels.*`、`duration.*`、`runsOutNow` 保留上游译文（中文 `duration.*` 已在工单 06 改为 `{{value}}d/h/m`）。

## 键的对应

| providerUsage 键 | Osuna 来源键 |
|---|---|
| `options` | `usage.planUsage.options` |
| `refreshFailed` | `usage.planUsage.refreshFailed` |
| `noHosts` | `usage.planUsage.noHosts` |
| `agentError` | `usage.planUsage.agentError` |
| `pin` | `usage.planUsage.pin` |
| `unpin` | `usage.planUsage.unpin` |
| `displayAs` | `usage.planUsage.displayAs` |
| `displayUsed` | `usage.planUsage.displayUsed` |
| `displayRemaining` | `usage.planUsage.displayRemaining` |
| `showInSidebar` | `usage.planUsage.showInSidebar` |
| `showInSidebarHint` | `usage.planUsage.showInSidebarHint` |
| `runToRefresh` | `usage.planUsage.remedyRun` |
| `signInAgain` | `usage.planUsage.remedySignIn` |
| `loginRejected` | `usage.planUsage.loginRejected` |
| `loginExpired` | `usage.planUsage.loginExpired` |
| `title` | `usage.planUsage.title` |
| `refresh` | `usage.planUsage.refresh` |
| `refreshAll` | `usage.planUsage.refreshAll` |
| `refreshing` | `usage.planUsage.refreshing` |
| `loading` | `usage.planUsage.loading` |
| `empty` | `usage.planUsage.empty` |
| `errorTitle` | `usage.planUsage.errorTitle` |
| `hostUnavailable` | `usage.planUsage.connectHostToSee` |
| `hostUpgradeRequired` | `usage.planUsage.updateHostToSee` |
| `clientUnavailable` | `usage.planUsage.clientUnavailable` |
| `retry` | `usage.planUsage.retry` |
| `tooltipLoading` | `usage.planUsage.loading` |
| `status.error` | `usage.planUsage.status.error` |
| `status.unavailable` | `usage.planUsage.status.unavailable` |
| `values.remaining` | `usage.planUsage.balanceLeft` |
| `timing.lastUpdated` | `usage.planUsage.lastUpdated` |
| `timing.noSuccessfulUpdate` | `usage.planUsage.noSuccessfulUpdate` |
| `timing.resetTimePassed` | `usage.planUsage.resetTimePassed` |
| `timing.resettingNow` | `usage.planUsage.resettingNow` |
| `timing.resetsIn` | `usage.planUsage.resets` |
| `timing.runsOutIn` | `usage.planUsage.runsOut` |
| `timing.updated` | `usage.planUsage.updated` |
| `timing.justNow` | `usage.common.time.justNow` |
| `timing.minutesAgo` | `usage.common.time.minutesAgo` |
| `timing.hoursAgo` | `usage.common.time.hoursAgo` |
| `timing.daysAgo` | `usage.common.time.daysAgo` |
| `values.used` | `usage.planUsage.summaryWindowUsed（去掉 {{name}}）` |

## 各语言改动的值（改前为上游译法 → 改后为 Osuna 译法）

### en（7 处）

| 键 | 上游 | Osuna |
|---|---|---|
| `options` | Settings | Plan usage options |
| `refreshFailed` | Unable to refresh usage | Unable to refresh plan usage |
| `displayAs` | Percentages | Show |
| `showInSidebar` | Summary in sidebar | Show in sidebar |
| `loading` | Loading usage... | Loading plan usage... |
| `empty` | No usage data | No plan usage data |
| `errorTitle` | Unable to load usage | Unable to load plan usage |

### zh-CN（20 处）

| 键 | 上游 | Osuna |
|---|---|---|
| `options` | 设置 | 套餐用量选项 |
| `refreshFailed` | 无法刷新用量 | 无法刷新套餐用量 |
| `displayAs` | 百分比 | 显示 |
| `displayUsed` | 已使用 | 已用 |
| `showInSidebar` | 在侧边栏显示摘要 | 在侧边栏显示 |
| `showInSidebarHint` | 固定的时间窗口显示在侧边栏底部 | 固定的套餐用量窗口显示在侧边栏底部 |
| `runToRefresh` | 运行 {{command}} 以刷新。 | 运行 {{command}} 以刷新登录。 |
| `loginExpired` | 登录已于{{relativeTime}}过期。{{remedy}} | 登录已过期（{{relativeTime}}）。{{remedy}} |
| `refreshing` | 刷新中... | 刷新中… |
| `loading` | 正在加载用量... | 正在加载套餐用量… |
| `empty` | 暂无用量数据 | 暂无套餐用量数据 |
| `errorTitle` | 无法加载用量 | 无法加载套餐用量 |
| `tooltipLoading` | 正在加载套餐用量... | 正在加载套餐用量… |
| `timing.lastUpdated` | 上次更新于 {{relativeTime}} | 最后更新于{{relativeTime}} |
| `timing.noSuccessfulUpdate` | 尚无成功更新 | 尚未成功更新 |
| `timing.resetTimePassed` | 重置时间已过 | 已过重置时间 |
| `timing.updated` | 更新于 {{relativeTime}} | {{relativeTime}}更新 |
| `timing.minutesAgo` | {{value}}分钟前 | {{value}} 分钟前 |
| `timing.hoursAgo` | {{value}}小时前 | {{value}} 小时前 |
| `timing.daysAgo` | {{value}}天前 | {{value}} 天前 |

### ja（21 处）

| 键 | 上游 | Osuna |
|---|---|---|
| `options` | 設定 | プラン使用量のオプション |
| `refreshFailed` | 使用状況を更新できません | プラン使用量を更新できません |
| `agentError` | 使用状況を読み込めません: {{reason}} | プラン使用量を読み込めません: {{reason}} |
| `displayAs` | 割合 | 表示 |
| `showInSidebar` | サイドバーに概要を表示 | サイドバーに表示 |
| `showInSidebarHint` | ピン留めした期間をサイドバーの下部に表示します | ピン留めした枠はサイドバー下部に表示されます |
| `signInAgain` | 再度サインインしてください。 | もう一度サインインしてください。 |
| `loginRejected` | ログインが拒否されました (HTTP {{status}})。{{remedy}} | ログインが拒否されました（HTTP {{status}}）。{{remedy}} |
| `loginExpired` | ログインは{{relativeTime}}に期限切れになりました。{{remedy}} | ログインの有効期限が切れました（{{relativeTime}}）。{{remedy}} |
| `loading` | 使用状況を読み込み中... | プラン使用量を読み込み中... |
| `empty` | 使用状況データがありません | プラン使用量のデータがありません |
| `errorTitle` | 使用状況を読み込めません | プラン使用量を読み込めません |
| `hostUnavailable` | {{host}} に接続してプロバイダーの使用状況を確認してください | {{host}} に接続するとプラン使用量を表示できます |
| `hostUpgradeRequired` | {{host}} を更新してプロバイダーの使用状況を確認してください | {{host}} を更新するとプラン使用量を表示できます |
| `tooltipLoading` | プラン使用状況を読み込み中... | プラン使用量を読み込み中... |
| `timing.lastUpdated` | 最終更新: {{relativeTime}} | 最終更新 {{relativeTime}} |
| `timing.noSuccessfulUpdate` | 正常な更新はまだありません | まだ更新に成功していません |
| `timing.resetTimePassed` | リセット時刻を過ぎています | リセット時刻を過ぎました |
| `timing.resettingNow` | まもなくリセット | リセット中 |
| `timing.runsOutIn` | {{duration}}後に上限に到達 | {{duration}}後に上限 |
| `timing.updated` | 更新: {{relativeTime}} | {{relativeTime}}に更新 |

### ko（26 处）

| 键 | 上游 | Osuna |
|---|---|---|
| `options` | 설정 | 플랜 사용량 옵션 |
| `refreshFailed` | 사용량을 새로 고칠 수 없습니다 | 플랜 사용량을 새로고침할 수 없습니다 |
| `agentError` | 사용량을 불러올 수 없습니다: {{reason}} | 플랜 사용량을 불러올 수 없음: {{reason}} |
| `displayAs` | 백분율 | 표시 |
| `showInSidebar` | 사이드바에 요약 표시 | 사이드바에 표시 |
| `showInSidebarHint` | 고정된 기간이 사이드바 하단에 표시됩니다 | 고정한 창은 사이드바 하단에 표시됩니다 |
| `runToRefresh` | {{command}} 명령을 실행하여 새로 고치세요. | {{command}}을(를) 실행해 갱신하세요. |
| `loginRejected` | 로그인이 거부되었습니다 (HTTP {{status}}). {{remedy}} | 로그인이 거부되었습니다(HTTP {{status}}). {{remedy}} |
| `loginExpired` | 로그인이 {{relativeTime}}에 만료되었습니다. {{remedy}} | 로그인이 만료되었습니다({{relativeTime}}). {{remedy}} |
| `refresh` | 새로 고침 | 새로고침 |
| `refreshAll` | 모두 새로 고침 | 모두 새로고침 |
| `refreshing` | 새로 고치는 중... | 새로고침 중... |
| `loading` | 사용량 불러오는 중... | 플랜 사용량 불러오는 중... |
| `empty` | 사용량 데이터가 없습니다 | 플랜 사용량 데이터 없음 |
| `errorTitle` | 사용량을 불러올 수 없습니다 | 플랜 사용량을 불러올 수 없습니다 |
| `hostUnavailable` | {{host}}에 연결하여 제공업체 사용량을 확인하세요 | {{host}}에 연결하면 플랜 사용량을 볼 수 있습니다 |
| `hostUpgradeRequired` | {{host}}를 업데이트하여 제공업체 사용량을 확인하세요 | {{host}}을(를) 업데이트하면 플랜 사용량을 볼 수 있습니다 |
| `status.unavailable` | 사용할 수 없음 | 사용 불가 |
| `timing.lastUpdated` | 마지막 업데이트: {{relativeTime}} | 마지막 업데이트 {{relativeTime}} |
| `timing.noSuccessfulUpdate` | 성공한 업데이트가 없습니다 | 아직 업데이트에 성공하지 못했습니다 |
| `timing.resetTimePassed` | 초기화 시간이 지났습니다 | 초기화 시각이 지났습니다 |
| `timing.resettingNow` | 지금 재설정 중 | 초기화 중 |
| `timing.resetsIn` | {{duration}} 후 재설정 | {{duration}} 후 초기화 |
| `timing.runsOutIn` | {{duration}} 후 한도에 도달 | {{duration}} 후 소진 |
| `timing.updated` | {{relativeTime}}에 업데이트됨 | {{relativeTime}} 업데이트됨 |
| `timing.justNow` | 방금 | 방금 전 |

### es（20 处）

| 键 | 上游 | Osuna |
|---|---|---|
| `options` | Configuración | Opciones de uso del plan |
| `refreshFailed` | No se pudo actualizar el uso | No se pudo actualizar el uso del plan |
| `agentError` | No se pudo cargar el uso: {{reason}} | No se pudo cargar el uso del plan: {{reason}} |
| `unpin` | Desfijar | Desanclar |
| `displayAs` | Porcentajes | Mostrar |
| `showInSidebar` | Resumen en la barra lateral | Mostrar en la barra lateral |
| `showInSidebarHint` | Los períodos fijados aparecen al pie de la barra lateral | Las ventanas fijadas se muestran al pie de la barra lateral |
| `runToRefresh` | Ejecuta {{command}} para actualizar. | Ejecuta {{command}} para renovarla. |
| `loading` | Cargando uso... | Cargando el uso del plan... |
| `empty` | No hay datos de uso | Sin datos de uso del plan |
| `errorTitle` | No se pudo cargar el uso | No se pudo cargar el uso del plan |
| `hostUnavailable` | Conéctate a {{host}} para ver el uso del proveedor | Conéctate a {{host}} para ver el uso del plan |
| `hostUpgradeRequired` | Actualiza {{host}} para ver el uso del proveedor | Actualiza {{host}} para ver el uso del plan |
| `tooltipLoading` | Cargando uso del plan... | Cargando el uso del plan... |
| `values.remaining` | Quedan {{amount}} | queda {{amount}}（取 `percentLeft` 的 queda：一个键同时管百分比与余额，Osuna 原来百分比写 queda、余额写 quedan，按主要用途取百分比的写法） |
| `timing.noSuccessfulUpdate` | No hay actualizaciones correctas | Sin actualizaciones correctas |
| `timing.resetTimePassed` | Pasó la hora de restablecimiento | Ya pasó la hora de reinicio |
| `timing.resettingNow` | se restablece ahora | reiniciándose ahora |
| `timing.resetsIn` | se restablece en {{duration}} | se reinicia en {{duration}} |
| `values.used` | Usado: {{percentage}} | {{percentage}} usado |

### fr（20 处）

| 键 | 上游 | Osuna |
|---|---|---|
| `options` | Paramètres | Options de consommation du forfait |
| `refreshFailed` | Impossible d’actualiser l’utilisation | Impossible d'actualiser la consommation du forfait |
| `agentError` | Impossible de charger l’utilisation : {{reason}} | Impossible de charger la consommation du forfait : {{reason}} |
| `displayAs` | Pourcentages | Afficher |
| `showInSidebar` | Résumé dans la barre latérale | Afficher dans la barre latérale |
| `showInSidebarHint` | Les périodes épinglées apparaissent en bas de la barre latérale | Les fenêtres épinglées s'affichent en bas de la barre latérale |
| `runToRefresh` | Exécutez {{command}} pour actualiser. | Exécutez {{command}} pour la renouveler. |
| `title` | Utilisation du forfait | Consommation du forfait |
| `loading` | Chargement de l’utilisation... | Chargement de la consommation du forfait... |
| `empty` | Aucune donnée d’utilisation | Aucune donnée de consommation du forfait |
| `errorTitle` | Impossible de charger l’utilisation | Impossible de charger la consommation du forfait |
| `hostUnavailable` | Connectez-vous à {{host}} pour voir l’utilisation du fournisseur | Connectez-vous à {{host}} pour voir la consommation du forfait |
| `hostUpgradeRequired` | Mettez à jour {{host}} pour voir l’utilisation du fournisseur | Mettez à jour {{host}} pour voir la consommation du forfait |
| `clientUnavailable` | La connexion à l’hôte n’est pas prête | La connexion à l'hôte n'est pas prête |
| `tooltipLoading` | Chargement de l’utilisation du forfait... | Chargement de la consommation du forfait... |
| `values.remaining` | Il reste {{amount}} | {{amount}} restants |
| `timing.resetsIn` | se réinitialise dans {{duration}} | réinitialisation dans {{duration}} |
| `timing.runsOutIn` | s’épuise dans {{duration}} | épuisé dans {{duration}} |
| `timing.justNow` | à l’instant | à l'instant |
| `values.used` | Utilisé : {{percentage}} | {{percentage}} utilisés |

### pt-BR（19 处）

| 键 | 上游 | Osuna |
|---|---|---|
| `options` | Configurações | Opções de uso do plano |
| `refreshFailed` | Não foi possível atualizar o uso | Não foi possível atualizar o uso do plano |
| `agentError` | Não foi possível carregar o uso: {{reason}} | Não foi possível carregar o uso do plano: {{reason}} |
| `displayAs` | Porcentagens | Mostrar |
| `showInSidebar` | Resumo na barra lateral | Mostrar na barra lateral |
| `showInSidebarHint` | Os períodos fixados aparecem no rodapé da barra lateral | As janelas fixadas aparecem no rodapé da barra lateral |
| `runToRefresh` | Execute {{command}} para atualizar. | Execute {{command}} para renová-lo. |
| `loginExpired` | O login expirou {{relativeTime}}. {{remedy}} | Login expirado {{relativeTime}}. {{remedy}} |
| `loading` | Carregando uso... | Carregando o uso do plano... |
| `empty` | Sem dados de uso | Sem dados de uso do plano |
| `errorTitle` | Não foi possível carregar o uso | Não foi possível carregar o uso do plano |
| `hostUnavailable` | Conecte-se a {{host}} para ver o uso do provedor | Conecte-se a {{host}} para ver o uso do plano |
| `hostUpgradeRequired` | Atualize {{host}} para ver o uso do provedor | Atualize {{host}} para ver o uso do plano |
| `tooltipLoading` | Carregando uso do plano... | Carregando o uso do plano... |
| `timing.resetTimePassed` | O horário de redefinição passou | O horário de reinício já passou |
| `timing.resettingNow` | redefinindo agora | reiniciando agora |
| `timing.resetsIn` | redefine em {{duration}} | reinicia em {{duration}} |
| `timing.runsOutIn` | esgota em {{duration}} | acaba em {{duration}} |
| `values.used` | {{percentage}} usado | {{percentage}} usados |

### ru（19 处）

| 键 | 上游 | Osuna |
|---|---|---|
| `options` | Настройки | Параметры расхода по тарифу |
| `refreshFailed` | Не удалось обновить использование | Не удалось обновить расход по тарифу |
| `agentError` | Не удалось загрузить использование: {{reason}} | Не удалось загрузить расход по тарифу: {{reason}} |
| `displayAs` | Проценты | Показывать |
| `showInSidebar` | Сводка на боковой панели | Показывать в боковой панели |
| `showInSidebarHint` | Закреплённые периоды отображаются внизу боковой панели | Закреплённые окна показываются внизу боковой панели |
| `runToRefresh` | Выполните {{command}} для обновления. | Запустите {{command}}, чтобы обновить его. |
| `title` | Использование плана | Расход по тарифу |
| `loading` | Загрузка данных об использовании... | Загрузка расхода по тарифу... |
| `empty` | Нет данных об использовании | Нет данных о расходе по тарифу |
| `errorTitle` | Не удалось загрузить данные об использовании | Не удалось загрузить расход по тарифу |
| `hostUnavailable` | Подключитесь к {{host}}, чтобы увидеть использование провайдера | Подключитесь к {{host}}, чтобы увидеть расход по тарифу |
| `hostUpgradeRequired` | Обновите {{host}}, чтобы увидеть использование провайдера | Обновите {{host}}, чтобы увидеть расход по тарифу |
| `tooltipLoading` | Загрузка использования плана... | Загрузка расхода по тарифу... |
| `values.remaining` | Осталось: {{amount}} | осталось {{amount}} |
| `timing.noSuccessfulUpdate` | Успешных обновлений нет | Ещё не удалось обновить |
| `timing.resettingNow` | сброс сейчас | сбрасывается |
| `timing.daysAgo` | {{value}} дн. назад | {{value}} дн назад |
| `values.used` | Использовано: {{percentage}} | использовано {{percentage}} |

### ar（23 处）

| 键 | 上游 | Osuna |
|---|---|---|
| `options` | الإعدادات | خيارات استهلاك الخطة |
| `refreshFailed` | تعذّر تحديث الاستخدام | تعذّر تحديث استهلاك الخطة |
| `agentError` | تعذّر تحميل الاستخدام: {{reason}} | تعذّر تحميل استهلاك الخطة: {{reason}} |
| `displayAs` | النسب المئوية | عرض |
| `showInSidebar` | ملخص في الشريط الجانبي | عرض في الشريط الجانبي |
| `showInSidebarHint` | تظهر الفترات المثبتة في أسفل الشريط الجانبي | تظهر النوافذ المثبتة في أسفل الشريط الجانبي |
| `runToRefresh` | شغّل {{command}} للتحديث. | شغّل {{command}} لتجديده. |
| `loginRejected` | تم رفض تسجيل الدخول (HTTP {{status}}). {{remedy}} | رُفض تسجيل الدخول (HTTP {{status}}). {{remedy}} |
| `title` | استخدام الخطة | استهلاك الخطة |
| `loading` | جارٍ تحميل بيانات الاستخدام... | جارٍ تحميل استهلاك الخطة... |
| `empty` | لا توجد بيانات استخدام | لا توجد بيانات عن استهلاك الخطة |
| `errorTitle` | تعذّر تحميل بيانات الاستخدام | تعذّر تحميل استهلاك الخطة |
| `hostUnavailable` | اتصل بـ{{host}} لعرض استخدام المزوّد | اتصل بـ {{host}} لعرض استهلاك الخطة |
| `hostUpgradeRequired` | حدّث {{host}} لعرض استخدام المزوّد | حدّث {{host}} لعرض استهلاك الخطة |
| `retry` | حاول مرة أخرى | أعد المحاولة |
| `tooltipLoading` | جارٍ تحميل استخدام الخطة... | جارٍ تحميل استهلاك الخطة... |
| `values.remaining` | متبقٍ {{amount}} | المتبقي {{amount}} |
| `timing.resetsIn` | تتم إعادة التعيين خلال {{duration}} | إعادة التعيين بعد {{duration}} |
| `timing.runsOutIn` | ينفد خلال {{duration}} | ينفد بعد {{duration}} |
| `timing.minutesAgo` | قبل {{value}} دقيقة | قبل {{value}} د |
| `timing.hoursAgo` | قبل {{value}} ساعة | قبل {{value}} س |
| `timing.daysAgo` | قبل {{value}} يومًا | قبل {{value}} ي |
| `values.used` | تم استخدام {{percentage}} | المستخدم {{percentage}} |

## 删掉的 `usage.planUsage` 键（与上游重复）

`title` `options` `refreshFailed` `noHosts` `retry` `connectHostToSee` `updateHostToSee` `loginExpired` `loginRejected` `remedyRun` `remedySignIn` `pin` `unpin` `displayAs` `displayUsed` `displayRemaining` `showInSidebar` `showInSidebarHint` `refreshAll` `agentError` `refresh` `refreshing` `loading` `empty` `errorTitle` `clientUnavailable` `updated` `resets` `resettingNow` `lastUpdated` `resetTimePassed` `noSuccessfulUpdate` `runsOut` `balanceLeft` `percentLeft` `summaryWindowUsed` `summaryWindowLeft` `status.*`

留下的 Osuna 独有键：`accountName` `apiEndpointsOnNote` `cliSignInsOff` `openPrivacySettings` `hostUnavailable`（不带主机名的那句）`summaryLabel` `summarySeparator` `strip.*`。
