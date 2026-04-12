# Condiciones Para Tener Un Champion

Este documento resume las condiciones reales que exige el código para que un `QMON` pueda convertirse en `champion`, y también por qué puedes pasar más de 24 horas sin ver ni `champion` ni trades.

La lógica base está en [src/qmon/qmon-champion.service.ts](/Users/jc/Documents/GitHub/qmon/src/qmon/qmon-champion.service.ts:12) y [src/qmon/qmon-engine.service.ts](/Users/jc/Documents/GitHub/qmon/src/qmon/qmon-engine.service.ts:2308).

## Resumen Corto

Para que exista un `champion`, primero tiene que haber candidatos que:

- estén `active`
- hayan operado suficiente
- tengan PnL positivo reciente y acumulado
- superen filtros de drawdown, fees y slippage
- no estén sobreoperando sin edge
- pasen validación temporal `2 de 3` ventanas
- no tengan el mercado bloqueado
- no tengan estado interno inconsistente

Si ningún candidato cumple todo eso, `activeChampionQmonId` se queda en `null`.

Además, para que haya trades nuevos, cada QMON tiene que superar varias compuertas previas:

- trigger gate
- time gate
- regime gate
- performance quarantine
- tradeability gate

Si el embudo de evaluación rechaza a casi todos antes del final, tampoco habrá trades, y por tanto será difícil acumular evidencia suficiente para producir un `champion`.

## Umbrales Reales Del Champion

Los umbrales duros más importantes salen de [src/qmon/qmon-champion.service.ts](/Users/jc/Documents/GitHub/qmon/src/qmon/qmon-champion.service.ts:12):

- Ventanas recientes mínimas: `5`
- Ventana larga de evaluación: `30`
- Ventana media para validación: `15`
- `fitnessScore` mínimo: `> 150`
- `winRate` mínimo: `0.55`
- mediana reciente de `paperWindowPnls`: `>= 0.5`
- tasa máxima de ventanas negativas en las últimas `10`: `<= 0.4`
- cobertura mínima de regímenes positivos: `2`
- exposición máxima sin edge claro: `0.8`
- `tradesPerWindow` máximo sin edge claro: `1.5`
- `netPnlPerTrade` considerado edge positivo: `>= 0.1`

Además usa umbrales de `config` en [src/config.ts](/Users/jc/Documents/GitHub/qmon/src/config.ts:50):

- trades mínimos walk-forward: `QMON_REAL_MIN_WF_TRADES = 10`
- PnL mínimo walk-forward: `QMON_REAL_MIN_WF_NET_PNL_USD = 1`
- drawdown máximo walk-forward: `QMON_REAL_MAX_WF_DRAWDOWN_USD = 4`
- fee ratio máximo: `QMON_REAL_MAX_WF_FEE_RATIO = 0.45`
- slippage máximo reciente: `QMON_REAL_MAX_WF_SLIPPAGE_BPS = 80`

## Razones Que Descalifican Un Champion

Un QMON solo es elegible si `championEligibilityReasons` queda vacío en [src/qmon/qmon-champion.service.ts](/Users/jc/Documents/GitHub/qmon/src/qmon/qmon-champion.service.ts:523).

Las razones posibles son:

- `inactive`
  El QMON no está en lifecycle `active`.
- `insufficient-windows`
  No tiene al menos `5` ventanas con evidencia suficiente.
- `non-positive-sum`
  La suma de PnL reciente no es positiva.
- `non-positive-median`
  La mediana de PnL reciente activo es menor que `0.5`.
- `non-positive-pnl`
  El `totalPnl` acumulado no es positivo.
- `low-win-rate`
  `winRate < 0.55` y además no compensa con edge por trade.
- `insufficient-trades`
  Tiene menos de `10` trades.
- `insufficient-recent-settled-trades`
  En mercado `healthy`, tiene menos de `3` trades cerrados recientes.
- `negative-recent-settled-pnl`
  Los trades cerrados recientes suman PnL no positivo.
- `low-recent-settled-win-rate`
  En trades recientes cerrados, `winRate < 0.45` y además el PnL reciente no es positivo.
- `poor-ev-realization`
  La realización de EV reciente es menor que `0.1`.
- `low-fitness`
  `fitnessScore <= 150`.
- `non-positive-long-window-sum`
  La suma de PnL de la ventana larga no es positiva.
- `low-long-window-pnl`
  La ventana larga suma menos de `1` USD neto.
- `high-negative-window-rate`
  Más del `40%` de las últimas `10` ventanas son negativas.
- `high-drawdown`
  `maxDrawdown > 4`.
- `high-fee-ratio`
  Si ya tiene al menos `10` trades, `feeRatio > 0.45`.
- `high-slippage`
  El slippage reciente supera `80 bps`.
- `weak-regime-coverage`
  No gana en al menos `2` regímenes con trades.
- `overexposed-without-edge`
  Exposición alta con poco edge por trade.
- `overtrading-without-edge`
  Opera demasiado por ventana sin suficiente edge.
- `fails-out-of-sample-validation`
  Falla la validación temporal `2 de 3`.
- `market-health-blocked`
  El mercado está bloqueado.
- `inconsistent-state`
  La posición, pending orders o estado interno no cuadran.

## Validación Temporal 2 De 3

Aunque un QMON vaya bien en una racha corta, el código exige pasar al menos `2` de estas `3` pruebas en [src/qmon/qmon-champion.service.ts](/Users/jc/Documents/GitHub/qmon/src/qmon/qmon-champion.service.ts:598):

- suma reciente positiva
- suma media positiva
- suma larga positiva

Si solo gana en una escala temporal, queda bloqueado con `fails-out-of-sample-validation`.

## Excepción Por Shadow Validation

Hay una vía alternativa de elegibilidad basada en evidencia shadow en [src/qmon/qmon-champion.service.ts](/Users/jc/Documents/GitHub/qmon/src/qmon/qmon-champion.service.ts:351).

Para que esa excepción ayude, hacen falta simultáneamente:

- al menos `24` resoluciones shadow
- `shadowNetPnl > 0`
- `shadowAccuracy >= 0.55`
- `shadowMeanBrierScore <= 0.24`

Si no existe esa evidencia, se aplican todos los filtros normales.

## Por Qué Puedes Estar 24h Sin Champion

Las causas más probables, viendo la lógica actual, son estas:

1. Sí hay evaluación, pero no suficiente actividad útil.
   El champion necesita al menos `10` trades, `5` ventanas con evidencia, y PnL reciente y largo positivos.

2. Sí hay trades en paper, pero con calidad insuficiente.
   Un candidato puede operar y aun así quedar fuera por `low-fitness`, `low-long-window-pnl`, `high-slippage`, `high-fee-ratio` o `fails-out-of-sample-validation`.

3. Casi no se están abriendo trades.
   Si los QMONs fallan antes en el embudo, nunca acumulan historial suficiente para convertirse en champion.

4. El mercado está bloqueado o degradado.
   Si `marketHealth.state === "blocked"`, ningún candidato puede ser champion.

## Por Qué Puedes Estar 24h Sin Trades

Antes de abrir una entrada, el motor rechaza trades por varias razones en [src/qmon/qmon-engine.service.ts](/Users/jc/Documents/GitHub/qmon/src/qmon/qmon-engine.service.ts:2372):

- `trigger-gate-blocked`
- `time-gate-blocked`
- `regime-gate-blocked`
- `performance-gate-blocked`
- `final-outcome-confidence-too-low`
- `final-outcome-edge-too-low`
- `net-ev-non-positive`
- `uncertainty-too-high`
- `directional-conflict`
- `fill-quality-too-low`
- `predicted-slippage-too-high`
- `spread-penalty-too-high`
- `insufficient-confirmations`
- `book-opposes-direction`
- `position-size-invalid`

Con la configuración por defecto, algunos mínimos importantes son:

- confirmaciones mínimas: `2`
- fill quality mínima: `0.5`
- slippage máximo de entrada: `80 bps`
- probabilidad mínima final: `max(confidenceThreshold del QMON, 0.55)`
- EV neto estimado: debe ser `> 0`

Eso significa que aunque haya señal direccional, no habrá trade si el libro está flojo, el spread es malo, el slippage estimado es alto o la EV neta sale negativa tras fees.

## Cómo Diagnosticar Qué Está Pasando Ahora

El server ya expone casi todo lo necesario:

### 1. Ver si existe champion por mercado

Usa `GET /api/qmons`.

Campos clave:

- `activeChampionQmonId`
- `marketHealth`
- `evaluationFunnel`
- `qmons[].metrics.isChampionEligible`
- `qmons[].metrics.championEligibilityReasons`

La respuesta se arma en [src/http/http-server.service.ts](/Users/jc/Documents/GitHub/qmon/src/http/http-server.service.ts:257).

### 2. Ver por qué no entran trades

Usa:

- `GET /api/qmons/diagnostics/overview?range=24h`
- `GET /api/qmons/diagnostics/market?market=btc-5m&range=24h`

Ahí puedes mirar `rejectionFunnel` y ver qué razones dominan. Esa parte se expone en [src/http/http-server.service.ts](/Users/jc/Documents/GitHub/qmon/src/http/http-server.service.ts:553).

### 3. Ver si hay actividad paper aunque no haya champion

En `GET /api/qmons` mira:

- `paperActivitySummary.totalTrades`
- `paperActivitySummary.totalPnl`
- `paperActivitySummary.positiveQmonCount`

Si aquí todo está casi a cero, el problema principal es falta de entradas.

### 4. Ver la razón concreta de inelegibilidad

Busca mercados donde:

- `activeChampionQmonId = null`
- muchos QMONs tengan las mismas `championEligibilityReasons`

Si se repiten `insufficient-trades`, `insufficient-windows` o `fails-out-of-sample-validation`, el sistema todavía no ha acumulado evidencia suficiente.

Si se repiten `high-slippage`, `net-ev-non-positive` o `fill-quality-too-low`, el cuello de botella está en la calidad de ejecución y microestructura.

## Lectura Práctica Para Tu Caso

Si llevas más de 24h sin ver ni `champion` ni trades, la lectura más probable es una de estas dos:

- el embudo de entrada está rechazando casi todo antes de abrir posiciones
- sí hay alguna actividad, pero ningún candidato llega a `10` trades con PnL, fitness y validación temporal suficientes

En este sistema, “no tener champion” no significa necesariamente que esté roto. Muchas veces significa que el filtro es deliberadamente estricto y que la evidencia reciente no alcanza los mínimos.

## Qué Miraría Primero

Por orden:

1. `GET /api/qmons/diagnostics/overview?range=24h`
   Mira `rejectionFunnel` para saber si el bloqueo está en triggers, régimen, horario o tradeability.
2. `GET /api/qmons`
   Mira si `activeChampionQmonId` está a `null` en todos los mercados.
3. Dentro de cada mercado, revisa `qmons[].metrics.championEligibilityReasons`.
4. Si predominan razones de actividad insuficiente, el problema es falta de trades.
5. Si predominan razones de calidad, el problema es que sí evalúa pero la EV o la microestructura no pasan el corte.

## Referencias De Código

- [src/qmon/qmon-champion.service.ts](/Users/jc/Documents/GitHub/qmon/src/qmon/qmon-champion.service.ts:12)
- [src/qmon/qmon-champion.service.ts](/Users/jc/Documents/GitHub/qmon/src/qmon/qmon-champion.service.ts:523)
- [src/qmon/qmon-champion.service.ts](/Users/jc/Documents/GitHub/qmon/src/qmon/qmon-champion.service.ts:598)
- [src/qmon/qmon-engine.service.ts](/Users/jc/Documents/GitHub/qmon/src/qmon/qmon-engine.service.ts:2308)
- [src/qmon/qmon-engine.service.ts](/Users/jc/Documents/GitHub/qmon/src/qmon/qmon-engine.service.ts:2372)
- [src/http/http-server.service.ts](/Users/jc/Documents/GitHub/qmon/src/http/http-server.service.ts:257)
- [src/http/http-server.service.ts](/Users/jc/Documents/GitHub/qmon/src/http/http-server.service.ts:553)
