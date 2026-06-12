# GitOps, Observability & Progressive Delivery (Argo Rollouts Canary)

This repository contains a unified GitOps project integrating the Morning Web Application and the Afternoon API Canary/Observability Challenge for the Week 9 Lab.

---

## 1. Overview & Architecture

The project demonstrates a complete automated deployment pipeline using **GitOps**, continuous feedback via **Observability (SLO Alerting)**, and **Progressive Delivery (Canary Deployments)** with auto-rollback.

```
                  +--------------------------------+
                  |           GitHub Repo          |
                  +---------------+----------------+
                                  |
                                  v
                  +---------------+----------------+
                  |            ArgoCD              |
                  +---------------+----------------+
                                  | (Auto-Sync)
                                  v
                  +---------------+----------------+
                  |       Kubernetes Cluster       |
                  +---------------+----------------+
                                  |
            +---------------------+---------------------+
            | (Morning App)                             | (Afternoon App)
            v                                           v
+-----------+-----------+                   +-----------+-----------+
|          web          |                   |          api          |
|  Frontend & Backend   |                   |   Flask App (v2/v3)   |
+-----------+-----------+                   +-----------+-----------+
            |                                           |
            | (Exposes metrics)                         | (Exposes metrics)
            v                                           v
+-----------+-------------------------------------------+-----------+
|                        Prometheus & Grafana                       |
+-----------+-------------------------------------------+-----------+
            |                                           |
            | (Triggers Alert on SLO breach)            | (Validates Canary health)
            v                                           v
+-----------+-----------+                   +-----------+-----------+
|     Alertmanager      |                   |     Argo Rollouts     |
|   (Sends Email Alert) |                   |    (Auto-Abort/Roll)  |
+-----------------------+                   +-----------------------+
```

### Key Components:
1. **Morning App (`web`)**: A multi-tier web application consisting of a React frontend and a Node.js backend.
2. **Afternoon App (`api`)**: A Flask-based API service packaged using Docker, exposing custom Prometheus metrics (request totals and status codes).
3. **Monitoring Stack**: Installed via `kube-prometheus-stack` to collect metrics, query HTTP request rates, and handle alerting rules.
4. **Progressive Delivery**: Managed by `argo-rollouts` to orchestrate canary rollout steps, evaluate performance metrics during update stages, and abort/rollback automatically on failure.

---

## 2. Directory Structure

```text
.
├── .github/workflows/    # CI workflows (YAML validation)
├── app/                  # Application source code
│   ├── backend/          # Node.js backend source code
│   ├── frontend/         # React frontend source code
│   ├── Dockerfile        # Dockerfile for the Flask API app
│   └── app.py            # Python Flask API code exposing metrics
├── argocd/               # ArgoCD Application manifests (App-of-Apps pattern)
│   ├── apps/             # Child applications (web, api, monitoring, rollouts)
│   └── root.yaml         # Root Application managing all child apps
├── k8s/                  # Kubernetes manifests for the Morning web app
├── k8s-api/              # Kubernetes manifests for the Afternoon api app
│   ├── api.yaml          # Rollout (Canary strategy) & Service
│   ├── analysis.yaml     # AnalysisTemplate for success rate evaluation
│   ├── prometheusrule.yaml # PrometheusRule SLO alerts definition
│   └── servicemonitor.yaml # ServiceMonitor for scraping API metrics
├── evidence/             # Screenshots folder verifying the lab requirements
├── EVIDENCE.md           # Markdown report index pointing to all evidence screenshots
└── README.md             # Standard project documentation (this file)
```

---

## 3. Metrics, SLOs & Alerting Configuration

We implement automated feedback loops using Prometheus queries to measure service level indicators (SLIs) and enforce service level objectives (SLOs).

### 3.1. Canary Analysis Template (`api-success-rate`)
During a rollout, the `AnalysisTemplate` checks the Canary success rate every **30 seconds** using the following query:
* **Query**:
  ```promql
  (sum(rate(flask_http_request_total{namespace="demo", status!~"5.."}[2m])) or vector(1))
  /
  (sum(rate(flask_http_request_total{namespace="demo"}[2m])) or vector(1))
  ```
* **Success Condition**: `result[0] >= 0.95` (Success rate >= **95%**).
* **Failure Limit**: `failureLimit: 3`. If the success rate drops below 95% more than 3 times, the rollout is automatically **Aborted** and rolled back to the stable replica.

### 3.2. SLO Alerting Rule (`BackendHighErrorRate`)
We define a Prometheus alerting rule to notify operators if the error rate of the API service exceeds the allowed error budget:
* **Query**:
  ```promql
  (sum(increase(flask_http_request_total{namespace="demo", status=~"5.."}[1m])) or vector(0))
  /
  clamp_min((sum(increase(flask_http_request_total{namespace="demo"}[1m])) or vector(0)), 1)
  > 0.05
  ```
* **Condition**: Triggers when the error rate is greater than **5%** (`> 0.05`) for a continuous period of **1 minute** (`for: 1m`).
* **Alertmanager Action**: Sends email alerts directly to the target mailbox (`dhoang1401@gmail.com`).

---

## 4. Deployment Guide

### Prerequisites
* A running Kubernetes cluster (e.g., Minikube, Kind, or EKS)
* `kubectl` CLI installed
* ArgoCD installed in the cluster (`argocd` namespace)

### Steps to Deploy
1. **Apply the Root Application**:
   Deploy the master application to sync all services:
   ```bash
   kubectl apply -f argocd/root.yaml
   ```
2. **Verify Application Syncing**:
   ArgoCD will automatically instantiate all applications:
   * `kube-prometheus-stack` (Monitoring)
   * `argo-rollouts` (Canary controller)
   * `web` (Morning frontend/backend)
   * `api` (Afternoon API rollout)

3. **Check Resource Status**:
   ```bash
   kubectl get applications -n argocd
   kubectl get rollouts -n demo
   ```

---

## 5. Verification & Evidence

All validation screenshots confirming the success criteria are stored in the [evidence/](evidence/) directory and detailed in the [EVIDENCE.md](EVIDENCE.md) report.

* **[EVIDENCE.md](EVIDENCE.md)**: Full verification checklist with screenshot references.

