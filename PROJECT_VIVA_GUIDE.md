# W9 Observability + Canary - Cẩm Nang Vấn Đáp

Tài liệu này chỉ tập trung vào các phần đúng yêu cầu đề: GitOps, Prometheus, SLO/Alert, Argo Rollouts, canary auto-abort và rollback. Phần frontend/backend chỉ nhắc ở mức cần thiết vì app chỉ là nguồn tạo metric cho bài lab.

## 1. Mục Tiêu Dự Án

Dự án chứng minh một quy trình triển khai an toàn:

```text
Git push
  -> ArgoCD sync
  -> Kubernetes chạy app
  -> Prometheus scrape /metrics
  -> PrometheusRule phát hiện lỗi vượt SLO
  -> Alertmanager gửi email
  -> Argo Rollouts canary bản mới
  -> AnalysisTemplate đọc metric từ Prometheus
  -> bản tốt lên 100%, bản lỗi tự abort
```

Câu trả lời mẫu:

> Em xây dựng một hệ thống GitOps trên Kubernetes. Mọi thay đổi đi qua Git, ArgoCD tự sync vào cluster. App expose metrics cho Prometheus. Em đặt SLO là error rate của `/api/order` phải nhỏ hơn 5%. Khi deploy bản mới, Argo Rollouts canary từng bước và dùng AnalysisTemplate query Prometheus. Nếu error rate vượt ngưỡng, rollout tự abort về bản ổn định.

## 2. Thành Phần Chính

| Thành phần | Vai trò |
| --- | --- |
| GitHub repo | Source of truth |
| ArgoCD | Đồng bộ trạng thái từ Git vào Kubernetes |
| Root Application | App-of-apps, tự tạo các Application con |
| kube-prometheus-stack | Cài Prometheus, Grafana, Alertmanager |
| Argo Rollouts | Điều phối canary/promotion/abort |
| ServiceMonitor | Cho Prometheus biết scrape service nào |
| PrometheusRule | Định nghĩa alert theo SLO |
| AnalysisTemplate | Query Prometheus để quyết định canary tốt/xấu |
| Rollout | Thay Deployment để hỗ trợ canary |

## 3. Cấu Trúc File Cần Biết

```text
cloud/w9/lab/gitops/
  argocd/
    root.yaml
    apps/
      web.yaml
      kube-prometheus-stack.yaml
      argo-rollouts.yaml
  k8s/
    namespace.yaml
    web.yaml
    alertmanager-smtp-secret.example.yaml
  app/
    backend/
    frontend/
```

Trong vấn đáp, ưu tiên nói các file này:

- `argocd/root.yaml`: root app theo mô hình app-of-apps.
- `argocd/apps/web.yaml`: ArgoCD app deploy workload trong thư mục `k8s`.
- `argocd/apps/kube-prometheus-stack.yaml`: cài Prometheus/Grafana/Alertmanager.
- `argocd/apps/argo-rollouts.yaml`: cài Argo Rollouts controller.
- `k8s/namespace.yaml`: tạo namespace `demo` trước.
- `k8s/web.yaml`: file quan trọng nhất, chứa Rollout, Service, ServiceMonitor, PrometheusRule, AnalysisTemplate.

## 4. App Chỉ Cần Hiểu Gì?

Không cần trình bày sâu code frontend/backend. Chỉ cần hiểu app phục vụ 3 việc:

1. Backend có endpoint `/metrics` cho Prometheus scrape.
2. Backend có route `/api/order` để tạo request thành công/lỗi.
3. Backend có biến `ERROR_RATE` để giả lập bản tốt hoặc bản lỗi.

Metric quan trọng:

```text
gitops_demo_http_requests_total{route="/api/order",status="200"}
gitops_demo_http_requests_total{route="/api/order",status="500"}
```

Cách tính error rate:

```text
error rate = số request 5xx / tổng request /api/order
```

Biến môi trường:

```yaml
- name: VERSION
  value: "v1.6.0"
- name: ERROR_RATE
  value: "0.5"
```

Ý nghĩa:

- `VERSION`: đổi version để tạo revision mới cho Rollout.
- `ERROR_RATE="0"`: bản tốt.
- `ERROR_RATE="0.5"`: bản lỗi, khoảng 50% request trả HTTP 500.

## 5. Luồng GitOps

```text
Sửa manifest
  -> git add
  -> git commit
  -> git push
  -> ArgoCD phát hiện Git thay đổi
  -> ArgoCD sync vào Kubernetes
```

Điểm cần nói:

> Git là source of truth. Em không sửa tay trực tiếp trong cluster. Nếu cluster bị drift, ArgoCD self-heal về đúng trạng thái trong Git.

## 6. `argocd/root.yaml`

File này tạo root Application.

Block quan trọng:

```yaml
source:
  repoURL: https://github.com/bearh141/gitops.git
  targetRevision: main
  path: argocd/apps
```

Ý nghĩa:

- ArgoCD đọc repo GitHub.
- Theo dõi branch `main`.
- Lấy manifest Application con trong thư mục `argocd/apps`.

```yaml
syncPolicy:
  automated:
    prune: true
    selfHeal: true
```

Ý nghĩa:

- `automated`: tự sync khi Git thay đổi.
- `prune`: Git xóa resource thì cluster cũng xóa.
- `selfHeal`: ai sửa tay trong cluster thì ArgoCD đưa về giống Git.

Câu trả lời mẫu:

> Root app giúp em dùng mô hình app-of-apps. Chỉ cần apply root một lần, các app con như web, Prometheus và Argo Rollouts được quản lý qua Git.

## 7. `argocd/apps/web.yaml`

File này khai báo Application tên `web`.

```yaml
source:
  repoURL: https://github.com/bearh141/gitops.git
  targetRevision: main
  path: k8s
```

Ý nghĩa:

- App `web` lấy manifest trong thư mục `k8s`.
- Vì vậy `k8s/web.yaml` là nơi định nghĩa workload thật.

```yaml
destination:
  server: https://kubernetes.default.svc
  namespace: demo
```

Ý nghĩa:

- Deploy vào cluster hiện tại.
- Namespace đích là `demo`.

```yaml
syncOptions:
  - CreateNamespace=true
```

Nếu namespace chưa tồn tại, ArgoCD có thể tạo namespace.

## 8. `argocd/apps/kube-prometheus-stack.yaml`

File này cài monitoring stack bằng Helm chart.

```yaml
repoURL: https://prometheus-community.github.io/helm-charts
chart: kube-prometheus-stack
targetRevision: 65.1.1
```

Stack này gồm:

- Prometheus
- Grafana
- Alertmanager
- kube-state-metrics
- node-exporter
- Prometheus Operator

### Vì sao cần cấu hình selector?

```yaml
prometheus:
  prometheusSpec:
    serviceMonitorSelectorNilUsesHelmValues: false
    ruleSelectorNilUsesHelmValues: false
    serviceMonitorNamespaceSelector: {}
    ruleNamespaceSelector: {}
```

Ý nghĩa:

- Cho phép Prometheus đọc `ServiceMonitor` ở namespace `demo`.
- Cho phép Prometheus đọc `PrometheusRule` ở namespace `demo`.

Nếu thiếu phần này, Prometheus có thể không scrape được backend hoặc không nhận alert rule.

### Cấu hình Alertmanager gửi email

```yaml
alertmanager:
  alertmanagerSpec:
    secrets:
      - alertmanager-smtp
```

Mount secret SMTP vào Alertmanager.

```yaml
smtp_smarthost: smtp.gmail.com:587
smtp_from: groupshytpm3@gmail.com
smtp_auth_username: groupshytpm3@gmail.com
smtp_auth_password_file: /etc/alertmanager/secrets/alertmanager-smtp/smtp-password
```

Ý nghĩa:

- Alertmanager dùng Gmail SMTP để gửi email.
- Password không ghi trực tiếp trong Git.
- Password được đọc từ Kubernetes Secret.

```yaml
route:
  receiver: "null"
  routes:
    - receiver: personal-email
      matchers:
        - alertname = "BackendHighErrorRate"
```

Ý nghĩa:

- Mặc định alert đi vào receiver `"null"` để tránh spam.
- Chỉ alert `BackendHighErrorRate` mới gửi email.

```yaml
receivers:
  - name: personal-email
    email_configs:
      - to: dhoang1401@gmail.com
        send_resolved: true
```

Email cảnh báo gửi tới email cá nhân.

## 9. `argocd/apps/argo-rollouts.yaml`

File này cài Argo Rollouts controller.

```yaml
repoURL: https://argoproj.github.io/argo-helm
chart: argo-rollouts
targetRevision: 2.37.7
```

Argo Rollouts cung cấp CRD `Rollout` và controller để chạy canary.

```yaml
ignoreDifferences:
  - group: apiextensions.k8s.io
    kind: CustomResourceDefinition
    jsonPointers:
      - /spec
```

Ý nghĩa:

- Tránh ArgoCD báo OutOfSync do CRD có field động.
- Đây là xử lý drift kỹ thuật cho CRD, không ảnh hưởng workload chính.

## 10. `k8s/namespace.yaml`

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: demo
  annotations:
    argocd.argoproj.io/sync-wave: "-1"
```

Ý nghĩa:

- Tạo namespace `demo`.
- `sync-wave: "-1"` giúp namespace được apply trước các resource khác.

Nếu namespace chưa tồn tại mà Rollout/Service apply trước, có thể lỗi.

## 11. `k8s/web.yaml` - File Quan Trọng Nhất

File này chứa toàn bộ logic của challenge:

- `AnalysisTemplate`
- `PrometheusRule`
- `Rollout backend`
- `Service backend`
- `Rollout frontend`
- `Service frontend`
- `ServiceMonitor`

## 12. AnalysisTemplate

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: backend-error-rate
  namespace: demo
```

`AnalysisTemplate` là mẫu kiểm tra metric cho Argo Rollouts.

```yaml
interval: 30s
count: 3
successCondition: result[0] < 0.05
failureLimit: 1
```

Ý nghĩa:

- Cứ 30 giây query Prometheus một lần.
- Tối đa 3 lần.
- Thành công nếu kết quả nhỏ hơn `0.05`, tức error rate < 5%.
- Nếu fail quá giới hạn, rollout bị abort.

```yaml
provider:
  prometheus:
    address: http://kube-prometheus-stack-prometheus.monitoring.svc:9090
```

Argo Rollouts gọi Prometheus trong namespace `monitoring`.

Query:

```promql
(sum(increase(gitops_demo_http_requests_total{namespace="demo",route="/api/order",status=~"5.."}[1m])) or vector(0))
/
clamp_min((sum(increase(gitops_demo_http_requests_total{namespace="demo",route="/api/order"}[1m])) or vector(0)), 1)
```

Giải thích:

- Tử số: số request `/api/order` trả status `5xx` trong 1 phút.
- Mẫu số: tổng request `/api/order` trong 1 phút.
- `or vector(0)`: tránh lỗi khi chưa có dữ liệu.
- `clamp_min(..., 1)`: tránh chia cho 0.
- Kết quả là error rate.

## 13. PrometheusRule

```yaml
kind: PrometheusRule
metadata:
  name: backend-slo-alerts
  namespace: demo
  labels:
    release: kube-prometheus-stack
```

`PrometheusRule` định nghĩa alert theo SLO.

```yaml
- alert: BackendHighErrorRate
```

Tên alert. Alertmanager route dựa vào tên này để gửi email.

```yaml
expr: (...) > 0.05
for: 1m
```

Ý nghĩa:

- Alert khi error rate > 5%.
- Điều kiện phải đúng liên tục 1 phút mới chuyển sang `Firing`.

Trạng thái alert:

```text
Inactive -> Pending -> Firing
```

Nếu Pending rồi quay về Inactive, nghĩa là điều kiện đã hết đúng trước khi đủ 1 phút.

## 14. Backend Rollout

```yaml
kind: Rollout
metadata:
  name: backend
  namespace: demo
```

`Rollout` thay cho `Deployment` để hỗ trợ canary.

```yaml
replicas: 2
```

Luôn duy trì 2 pod backend.

```yaml
strategy:
  canary:
    steps:
      - setWeight: 25
      - analysis:
          templates:
            - templateName: backend-error-rate
      - setWeight: 50
      - analysis:
          templates:
            - templateName: backend-error-rate
      - setWeight: 100
```

Luồng canary:

1. Đưa một phần traffic sang bản mới.
2. Chạy analysis kiểm tra error rate.
3. Nếu tốt, tăng traffic lên.
4. Nếu xấu, abort.

Điểm vấn đáp:

> Canary không lên 100% ngay. Nó tăng dần và được Prometheus kiểm tra ở từng bước.

## 15. Backend Service

```yaml
kind: Service
metadata:
  name: backend
  labels:
    app: backend
spec:
  selector:
    app: backend
  ports:
    - name: http
      port: 3000
      targetPort: 3000
```

Ý nghĩa:

- Service chọn pod có label `app=backend`.
- Service expose port `3000`.
- Tên port là `http`, được `ServiceMonitor` dùng để scrape `/metrics`.

## 16. ServiceMonitor

```yaml
kind: ServiceMonitor
metadata:
  name: backend
  namespace: demo
  labels:
    release: kube-prometheus-stack
```

`ServiceMonitor` cho Prometheus biết phải scrape backend.

```yaml
selector:
  matchLabels:
    app: backend
endpoints:
  - port: http
    path: /metrics
    interval: 15s
```

Ý nghĩa:

- Chọn Service có label `app=backend`.
- Scrape port tên `http`.
- Gọi path `/metrics`.
- Lặp lại mỗi 15 giây.

Nếu `ServiceMonitor` sai label hoặc sai port name, Prometheus sẽ không thấy metric.

## 17. Luồng Canary Auto-Abort

```text
Git đổi VERSION/ERROR_RATE
  -> ArgoCD sync
  -> Rollout tạo ReplicaSet mới
  -> setWeight 25
  -> AnalysisTemplate query Prometheus
  -> nếu error rate < 5% thì tiếp tục
  -> nếu error rate >= 5% thì AnalysisRun Failed
  -> RolloutAborted
  -> stable ReplicaSet cũ tiếp tục phục vụ
```

Khi bản lỗi:

```yaml
ERROR_RATE: "0.5"
```

Kỳ vọng:

```text
AnalysisRun Failed
RolloutAborted
Rollout Phase: Degraded
Stable RS vẫn là bản cũ
```

Khi bản tốt:

```yaml
ERROR_RATE: "0"
```

Kỳ vọng:

```text
AnalysisRun Successful
Rollout Phase: Healthy
Current Step Index hoàn tất
Stable RS chuyển sang bản mới
```

## 18. Luồng Alert Email

```text
Load tạo request /api/order
  -> backend sinh lỗi 500
  -> Prometheus scrape metric
  -> PrometheusRule tính error rate
  -> BackendHighErrorRate Pending
  -> sau 1 phút nếu vẫn lỗi thì Firing
  -> Alertmanager nhận alert
  -> Alertmanager gửi email
```

Nếu log Alertmanager có:

```text
535 5.7.8 Username and Password not accepted
```

Nghĩa là:

- Alert đã tới Alertmanager.
- Cấu hình route đúng.
- Nhưng Gmail App Password hoặc username SMTP sai.

Nếu secret đúng, app password Gmail thường dài 16 ký tự:

```powershell
$b64 = kubectl -n monitoring get secret alertmanager-smtp -o jsonpath="{.data.smtp-password}"
$pw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
"length=$($pw.Length)"
```

Kỳ vọng:

```text
length=16
```

## 19. Các Lệnh Demo Quan Trọng

Kiểm tra ArgoCD:

```powershell
kubectl -n argocd get applications
```

Kiểm tra monitoring:

```powershell
kubectl -n monitoring get pods
```

Kiểm tra Argo Rollouts:

```powershell
kubectl -n argo-rollouts get pods
```

Kiểm tra resource bài làm:

```powershell
kubectl -n demo get rollouts.argoproj.io,svc,servicemonitor,prometheusrule,analysistemplate,pods
```

Xem rollout backend:

```powershell
kubectl -n demo describe rollout backend
```

Xem analysis:

```powershell
kubectl -n demo get analysisrun
```

Tạo load:

```powershell
kubectl -n demo delete pod load --ignore-not-found
kubectl -n demo run load --image=busybox --restart=Never -- sh -c "while true; do wget -qO- http://backend:3000/api/order?customer=alert-test; sleep 1; done"
```

Mở Prometheus:

```powershell
kubectl -n monitoring port-forward svc/kube-prometheus-stack-prometheus 9090:9090
```

Mở Alertmanager:

```powershell
kubectl -n monitoring port-forward svc/kube-prometheus-stack-alertmanager 9093:9093
```

Kiểm tra Alertmanager log:

```powershell
kubectl -n monitoring logs alertmanager-kube-prometheus-stack-alertmanager-0 -c alertmanager --tail=100
```

## 20. Git Revert Và Rollback

Rollback phải đi qua Git:

```powershell
git log --oneline
git revert <commit-id> --no-edit
git push
```

Trong PowerShell không gõ nguyên `<commit-id>`. Phải thay bằng mã commit thật:

```powershell
git revert a5328e5 --no-edit
```

Câu trả lời mẫu:

> Khi bản lỗi được commit lên Git, ArgoCD sync và Rollout tự abort. Nếu muốn rollback manifest về bản trước, em dùng `git revert`, push lên GitHub, ArgoCD tự đưa cluster về trạng thái ổn định. Đây là rollback có lịch sử, không sửa tay.

## 21. Vì Sao `web` Có Thể Degraded?

Nếu đang test bản lỗi:

```yaml
ERROR_RATE: "0.5"
```

thì `web Degraded` là hợp lý vì backend Rollout bị abort.

Điều cần chụp:

```text
RolloutAborted
AnalysisRun Failed
Stable RS vẫn là bản cũ
```

Sau khi demo xong, nên đưa về:

```yaml
ERROR_RATE: "0"
```

rồi commit/push để trạng thái cuối là:

```text
web Synced Healthy
backend Rollout Healthy
```

## 22. Câu Hỏi Vấn Đáp Hay Gặp

### Vì sao dùng GitOps?

Vì Git là source of truth. Mọi thay đổi có lịch sử commit, có thể review và rollback bằng `git revert`. ArgoCD tự đồng bộ cluster theo Git.

### Vì sao dùng Rollout thay Deployment?

Deployment chỉ rolling update cơ bản. Rollout hỗ trợ canary, pause, promote, abort và analysis dựa trên metric.

### Vì sao cần Prometheus?

Prometheus lưu metric theo thời gian. Argo Rollouts và PrometheusRule dùng metric đó để đánh giá chất lượng bản mới.

### Vì sao cần ServiceMonitor?

ServiceMonitor cho Prometheus biết scrape service nào, port nào, path nào.

### Vì sao cần AnalysisTemplate?

AnalysisTemplate cho Rollout biết query Prometheus nào dùng để quyết định bản mới đạt hay không.

### SLO của bài là gì?

Error rate của `/api/order` phải nhỏ hơn 5%.

### Khi nào alert Firing?

Khi error rate > 5% liên tục đủ `for: 1m`.

### Pending rồi Inactive là sao?

Điều kiện từng vượt ngưỡng nhưng không kéo dài đủ 1 phút. Thường do Rollout auto-abort quá nhanh làm traffic quay về bản tốt.

### Vì sao Application của em ít hơn người khác?

Em gộp workload vào Application `web`. Tên app không quan trọng bằng việc có đủ Rollout, ServiceMonitor, PrometheusRule, AnalysisTemplate và chứng minh được auto-abort.

### Secret SMTP có nên commit không?

Không. File chứa password thật không nên đưa lên Git. Chỉ nên commit file `.example.yaml` có placeholder.

## 23. Checklist Chụp Ảnh

Chụp các ảnh sau:

1. `kubectl -n argocd get applications`.
2. Monitoring pods Running.
3. Argo Rollouts pods Running.
4. `kubectl -n demo get rollouts.argoproj.io,svc,servicemonitor,prometheusrule,analysistemplate,pods`.
5. Prometheus query metric `gitops_demo_http_requests_total`.
6. Prometheus alert `BackendHighErrorRate`.
7. Alertmanager hoặc email nhận alert.
8. Bản tốt: `AnalysisRun Successful`, rollout `Healthy`.
9. Bản lỗi: `AnalysisRun Failed`, `RolloutAborted`, rollout `Degraded`.
10. GitHub commit và commit revert.

## 24. Bài Nói Mẫu 1 Phút

> Bài của em triển khai theo GitOps. Root Application của ArgoCD theo dõi thư mục `argocd/apps`, từ đó cài Prometheus stack, Argo Rollouts và app web. Workload chính nằm trong `k8s/web.yaml`. Backend expose `/metrics`, Prometheus scrape qua ServiceMonitor. Em định nghĩa SLO là error rate của `/api/order` dưới 5%, viết PrometheusRule để alert `BackendHighErrorRate` và Alertmanager gửi email. Phần canary dùng Argo Rollouts: bản mới đi qua các bước 25%, analysis, 50%, analysis, rồi 100%. AnalysisTemplate query Prometheus để tính error rate. Nếu bản tốt `ERROR_RATE=0`, rollout lên 100%. Nếu bản lỗi `ERROR_RATE=0.5`, AnalysisRun fail và Rollout tự abort, giữ stable ReplicaSet cũ. Rollback được thực hiện bằng `git revert`, không sửa tay trong cluster.

## 25. Cách Đọc Dự Án Từ Đầu Đến Cuối

Khi giảng viên hỏi “em trình bày dự án đi”, đừng bắt đầu từ frontend/backend. Hãy đi theo chuỗi điều khiển của đề:

```text
Git -> ArgoCD -> Kubernetes -> Prometheus -> Alertmanager -> Argo Rollouts
```

Giải thích từng mắt xích:

1. `Git`: nơi lưu mong muốn của hệ thống.
2. `ArgoCD`: người quan sát Git và sync vào cluster.
3. `Kubernetes`: nơi chạy workload.
4. `Prometheus`: nơi đo chất lượng bằng metric.
5. `Alertmanager`: nơi gửi cảnh báo ra email.
6. `Argo Rollouts`: nơi quyết định bản mới có được lên production hay không.

Câu nói mẫu:

> Em không chỉ deploy app. Em xây một quy trình release an toàn. Git quyết định trạng thái mong muốn, ArgoCD sync, Prometheus đo, Alertmanager cảnh báo, Argo Rollouts dùng metric để tự promote hoặc abort.

## 26. Giải Thích Kỹ `apiVersion`, `kind`, `metadata`, `spec`

Hầu hết YAML Kubernetes đều có 4 phần:

```yaml
apiVersion: ...
kind: ...
metadata:
  ...
spec:
  ...
```

### `apiVersion`

Ví dụ:

```yaml
apiVersion: argoproj.io/v1alpha1
```

Ý nghĩa:

- Cho Kubernetes biết resource này thuộc API group nào.
- `argoproj.io/v1alpha1` là API group của Argo Rollouts hoặc ArgoCD.
- `monitoring.coreos.com/v1` là API group của Prometheus Operator.
- `v1` là API core của Kubernetes, dùng cho `Service`, `Namespace`, `Secret`.

Nếu sai `apiVersion`, Kubernetes không biết kiểu resource đó là gì.

### `kind`

Ví dụ:

```yaml
kind: Rollout
```

Ý nghĩa:

- Cho biết loại resource cần tạo.
- `Rollout`: workload canary của Argo Rollouts.
- `Service`: endpoint ổn định để truy cập pod.
- `ServiceMonitor`: cấu hình scrape cho Prometheus.
- `PrometheusRule`: rule alert cho Prometheus.
- `Application`: resource của ArgoCD.

### `metadata`

Ví dụ:

```yaml
metadata:
  name: backend
  namespace: demo
```

Ý nghĩa:

- `name`: tên resource.
- `namespace`: resource nằm ở namespace nào.
- `labels`: nhãn để resource khác chọn.
- `annotations`: metadata phụ, thường dùng bởi ArgoCD hoặc controller.

### `spec`

Ví dụ:

```yaml
spec:
  replicas: 2
```

Ý nghĩa:

- Đây là trạng thái mong muốn.
- Với Rollout: muốn chạy bao nhiêu pod, image nào, canary thế nào.
- Với Service: selector nào, port nào.
- Với ServiceMonitor: scrape service nào, path nào.

Câu vấn đáp:

> `metadata` mô tả resource là ai và nằm ở đâu. `spec` mô tả em muốn resource đó hoạt động như thế nào.

## 27. Giải Thích Kỹ ArgoCD Root App

File: `argocd/root.yaml`

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root
  namespace: argocd
```

Giải thích:

- Đây là một `Application` của ArgoCD.
- Nó tên là `root`.
- Nó nằm trong namespace `argocd` vì ArgoCD quản lý Application ở đó.

```yaml
spec:
  project: default
```

`project: default` nghĩa là app thuộc project mặc định của ArgoCD. Trong lab nhỏ dùng default là đủ.

```yaml
source:
  repoURL: https://github.com/bearh141/gitops.git
  targetRevision: main
  path: argocd/apps
```

Giải thích kỹ:

- `repoURL`: repo Git mà ArgoCD theo dõi.
- `targetRevision`: branch/tag/commit cần deploy. Ở đây là `main`.
- `path`: thư mục trong repo chứa manifest.

Vì `path: argocd/apps`, root app không deploy workload trực tiếp. Nó deploy các Application con.

```yaml
destination:
  server: https://kubernetes.default.svc
  namespace: argocd
```

Giải thích:

- `server: https://kubernetes.default.svc` nghĩa là deploy vào chính cluster hiện tại.
- `namespace: argocd` vì Application con cũng nằm trong namespace `argocd`.

```yaml
syncPolicy:
  automated:
    prune: true
    selfHeal: true
```

Giải thích kỹ:

- `automated`: ArgoCD tự sync, không cần bấm Sync thủ công.
- `prune`: nếu Git xóa resource, cluster cũng xóa resource đó.
- `selfHeal`: nếu ai sửa tay trong cluster, ArgoCD tự sửa lại theo Git.

Ví dụ vấn đáp:

> Nếu em dùng `kubectl edit` sửa replicas trên cluster, ArgoCD phát hiện drift và self-heal về số replicas trong Git.

## 28. Giải Thích Kỹ ArgoCD App `web`

File: `argocd/apps/web.yaml`

```yaml
metadata:
  name: web
  namespace: argocd
```

App này tên `web`, nhưng nó không chỉ chứa frontend. Trong bài của em, `web` quản lý cả backend, frontend, SLO, alert và canary.

```yaml
source:
  repoURL: https://github.com/bearh141/gitops.git
  targetRevision: main
  path: k8s
```

Ý nghĩa:

- App `web` đọc thư mục `k8s`.
- Trong thư mục `k8s` có `namespace.yaml`, `web.yaml`, secret example.
- ArgoCD apply các manifest trong thư mục đó.

```yaml
destination:
  namespace: demo
```

Resource workload nằm trong namespace `demo`.

```yaml
syncOptions:
  - CreateNamespace=true
```

Nếu namespace `demo` chưa tồn tại, ArgoCD có thể tạo. Tuy nhiên mình vẫn có `namespace.yaml` để kiểm soát rõ namespace và sync-wave.

### Vì sao `web` có thể Degraded?

Nếu backend Rollout đang abort bản lỗi, health của app `web` sẽ là `Degraded`.

Điểm cần nhớ:

```text
Synced + Degraded = manifest đã giống Git, nhưng health của resource không tốt
OutOfSync = cluster khác Git
Sync failed = quá trình sync có task fail
```

Trong bài này, `Sync failed` có thể xuất hiện vì Rollout bản lỗi bị abort trong lúc ArgoCD sync. Đây là bằng chứng auto-abort, nhưng không nên để làm trạng thái cuối nộp bài.

## 29. Giải Thích Kỹ kube-prometheus-stack

File: `argocd/apps/kube-prometheus-stack.yaml`

### Source Helm chart

```yaml
source:
  repoURL: https://prometheus-community.github.io/helm-charts
  chart: kube-prometheus-stack
  targetRevision: 65.1.1
```

Giải thích:

- ArgoCD không chỉ deploy YAML thuần, nó còn deploy Helm chart.
- `kube-prometheus-stack` là chart phổ biến để cài Prometheus Operator.
- `targetRevision` pin version chart để lần sau deploy lại không bị thay đổi ngoài ý muốn.

### Vì sao dùng Prometheus Operator?

Prometheus Operator giúp mình dùng các custom resource như:

- `ServiceMonitor`
- `PrometheusRule`
- `Alertmanager`

Thay vì sửa file config Prometheus thủ công, mình khai báo Kubernetes resource. Cách này hợp với GitOps.

### Cấu hình selector

```yaml
serviceMonitorSelectorNilUsesHelmValues: false
ruleSelectorNilUsesHelmValues: false
serviceMonitorNamespaceSelector: {}
ruleNamespaceSelector: {}
```

Giải thích từng dòng:

- `serviceMonitorSelectorNilUsesHelmValues: false`: không chỉ chọn ServiceMonitor do Helm tạo.
- `ruleSelectorNilUsesHelmValues: false`: không chỉ chọn PrometheusRule do Helm tạo.
- `serviceMonitorNamespaceSelector: {}`: cho phép xem ServiceMonitor ở mọi namespace.
- `ruleNamespaceSelector: {}`: cho phép xem PrometheusRule ở mọi namespace.

Vì `ServiceMonitor` và `PrometheusRule` của mình nằm ở namespace `demo`, phần này rất quan trọng.

Nếu bị hỏi “thiếu block này thì sao?”:

> Prometheus có thể chạy bình thường nhưng không thấy ServiceMonitor/PrometheusRule của app, dẫn đến không scrape được metric hoặc không có alert.

### Alertmanager secret

```yaml
alertmanagerSpec:
  secrets:
    - alertmanager-smtp
```

Ý nghĩa:

- Mount Secret tên `alertmanager-smtp` vào pod Alertmanager.
- Secret chứa `smtp-password`.
- Không đưa password thật lên Git.

Trong container Alertmanager, password được đọc tại:

```text
/etc/alertmanager/secrets/alertmanager-smtp/smtp-password
```

### Route email

```yaml
route:
  receiver: "null"
  routes:
    - receiver: personal-email
      matchers:
        - alertname = "BackendHighErrorRate"
```

Giải thích:

- Receiver mặc định là `"null"` để bỏ qua alert hệ thống không liên quan.
- Chỉ alert có `alertname=BackendHighErrorRate` mới gửi email.

Vì sao làm vậy?

> kube-prometheus-stack tạo nhiều alert mặc định như Watchdog, KubeSchedulerDown. Nếu gửi hết qua Gmail sẽ spam và dễ bị Gmail giới hạn. Em chỉ route alert của bài lab.

## 30. Giải Thích Kỹ Argo Rollouts App

File: `argocd/apps/argo-rollouts.yaml`

```yaml
chart: argo-rollouts
targetRevision: 2.37.7
```

Chart này cài:

- Argo Rollouts controller.
- CRD `Rollout`.
- CRD `AnalysisTemplate`.
- CRD `AnalysisRun`.

Nếu chưa cài Argo Rollouts, Kubernetes sẽ không hiểu:

```yaml
kind: Rollout
kind: AnalysisTemplate
```

### `ignoreDifferences`

```yaml
ignoreDifferences:
  - group: apiextensions.k8s.io
    kind: CustomResourceDefinition
    jsonPointers:
      - /spec
```

CRD thường có field do Kubernetes hoặc Helm mutate. Nếu ArgoCD so sánh quá chặt, app có thể OutOfSync dù không có lỗi thực tế.

Nói trong vấn đáp:

> Em ignore phần `/spec` của CRD để tránh nhiễu OutOfSync ở resource hệ thống. Workload chính của em vẫn được ArgoCD quản lý bình thường.

## 31. Giải Thích Kỹ Namespace Và Sync Wave

File: `k8s/namespace.yaml`

```yaml
annotations:
  argocd.argoproj.io/sync-wave: "-1"
```

ArgoCD sync-wave điều khiển thứ tự apply.

Thứ tự trong bài:

```text
-1: Namespace demo
 0: AnalysisTemplate, PrometheusRule
 1: Backend Rollout
 2: Backend Service
 3: Frontend Rollout
 4: Frontend Service
 5: ServiceMonitor
```

Vì sao namespace wave `-1`?

> Namespace phải tồn tại trước khi tạo resource trong namespace đó.

Vì sao `AnalysisTemplate` wave `0` trước Rollout?

> Rollout cần tham chiếu `templateName: backend-error-rate`, nên AnalysisTemplate nên có trước khi rollout chạy analysis.

## 32. Giải Thích Kỹ AnalysisTemplate

Block:

```yaml
kind: AnalysisTemplate
metadata:
  name: backend-error-rate
```

Đây là mẫu phân tích chất lượng bản release.

```yaml
metrics:
  - name: backend-error-rate
```

Một AnalysisTemplate có thể có nhiều metric. Ở đây chỉ có một metric: error rate backend.

```yaml
interval: 30s
count: 3
```

Ý nghĩa:

- Cứ 30 giây chạy query một lần.
- Tối đa chạy 3 lần.

```yaml
successCondition: result[0] < 0.05
```

`result[0]` là kết quả đầu tiên trả về từ Prometheus query.

`0.05` nghĩa là 5%.

Nếu kết quả là:

```text
0.01 -> 1% -> pass
0.10 -> 10% -> fail
```

```yaml
failureLimit: 1
```

Nếu số lần fail vượt giới hạn này, AnalysisRun fail và Rollout abort.

### Query PromQL

```promql
(sum(increase(gitops_demo_http_requests_total{namespace="demo",route="/api/order",status=~"5.."}[1m])) or vector(0))
/
clamp_min((sum(increase(gitops_demo_http_requests_total{namespace="demo",route="/api/order"}[1m])) or vector(0)), 1)
```

Giải thích thật chậm:

```promql
gitops_demo_http_requests_total
```

Là counter tổng request backend.

```promql
route="/api/order"
```

Chỉ lấy route nghiệp vụ `/api/order`, không tính `/metrics` hay `/api/health`.

```promql
status=~"5.."
```

Regex chọn mọi HTTP status 5xx: 500, 502, 503...

```promql
increase(...[1m])
```

Tính số request tăng thêm trong 1 phút gần nhất.

```promql
sum(...)
```

Cộng tất cả pod backend lại.

```promql
or vector(0)
```

Nếu chưa có dữ liệu, trả về 0 thay vì query rỗng.

```promql
clamp_min(..., 1)
```

Ép mẫu số nhỏ nhất là 1 để tránh chia cho 0.

Câu trả lời mẫu:

> Query này lấy số request 5xx của `/api/order` trong 1 phút chia cho tổng request `/api/order` trong 1 phút. Nếu tỉ lệ này từ 5% trở lên thì bản mới bị xem là không đạt SLO.

## 33. Giải Thích Kỹ PrometheusRule

Block:

```yaml
kind: PrometheusRule
metadata:
  name: backend-slo-alerts
  labels:
    release: kube-prometheus-stack
```

`PrometheusRule` là rule alert. Label `release` giúp Prometheus Operator chọn rule này.

```yaml
groups:
  - name: backend-slo
```

Rule được gom vào group `backend-slo`.

```yaml
- alert: BackendHighErrorRate
```

Tên alert. Tên này phải khớp với route Alertmanager:

```yaml
matchers:
  - alertname = "BackendHighErrorRate"
```

```yaml
expr: (...) > 0.05
```

Điều kiện bắn alert: error rate vượt 5%.

```yaml
for: 1m
```

Prometheus yêu cầu điều kiện đúng liên tục 1 phút.

Trạng thái:

```text
Inactive: điều kiện sai
Pending : điều kiện đúng nhưng chưa đủ thời gian for
Firing  : điều kiện đúng đủ thời gian for
```

Nếu bị hỏi “vì sao Pending rồi Inactive?”:

> Vì lỗi chỉ vượt ngưỡng trong thời gian ngắn. Rollout auto-abort làm traffic quay về bản tốt, nên error rate giảm trước khi đủ 1 phút.

## 34. Giải Thích Kỹ Backend Rollout

Block:

```yaml
kind: Rollout
metadata:
  name: backend
```

Rollout là workload chính thay cho Deployment.

```yaml
replicas: 2
```

Mong muốn luôn có 2 pod backend.

```yaml
selector:
  matchLabels:
    app: backend
```

Rollout quản lý pod có label `app=backend`.

```yaml
template:
  metadata:
    labels:
      app: backend
```

Pod được tạo ra cũng có label `app=backend`, để Rollout và Service chọn đúng pod.

### Canary steps

```yaml
steps:
  - setWeight: 25
  - analysis:
      templates:
        - templateName: backend-error-rate
  - setWeight: 50
  - analysis:
      templates:
        - templateName: backend-error-rate
  - setWeight: 100
```

Ý nghĩa từng bước:

1. `setWeight: 25`: đưa một phần traffic/pod sang bản mới.
2. `analysis`: chạy kiểm tra Prometheus.
3. `setWeight: 50`: nếu ổn, tăng mức canary.
4. `analysis`: kiểm tra lần nữa.
5. `setWeight: 100`: nếu vẫn ổn, promote toàn bộ.

Với lab không có service mesh/ingress traffic splitting, `setWeight` chủ yếu thể hiện progressive rollout theo ReplicaSet/pod. Ý tưởng vẫn là không đưa bản mới lên toàn bộ ngay lập tức.

### Container env

```yaml
env:
  - name: VERSION
    value: "v1.7.0"
  - name: ERROR_RATE
    value: "0.5"
```

Đổi env làm pod template thay đổi, Rollout tạo revision mới.

### Readiness probe

```yaml
readinessProbe:
  httpGet:
    path: /api/health
    port: 3000
```

Kubernetes chỉ route traffic tới pod khi endpoint health trả OK.

Nếu readiness fail:

- Pod vẫn có thể Running.
- Nhưng không được xem là Ready.
- Service không nên gửi traffic tới pod đó.

## 35. Giải Thích Kỹ Service Và ServiceMonitor

### Backend Service

```yaml
kind: Service
metadata:
  name: backend
  labels:
    app: backend
```

Service có label `app=backend`. Label này quan trọng vì ServiceMonitor chọn Service bằng label.

```yaml
selector:
  app: backend
```

Service route traffic đến pod có label `app=backend`.

```yaml
ports:
  - name: http
    port: 3000
    targetPort: 3000
```

Giải thích:

- `name: http`: tên port, ServiceMonitor tham chiếu tên này.
- `port: 3000`: port của Service.
- `targetPort: 3000`: port container backend.

### ServiceMonitor

```yaml
selector:
  matchLabels:
    app: backend
```

ServiceMonitor tìm Service có label `app=backend`.

```yaml
endpoints:
  - port: http
    path: /metrics
    interval: 15s
```

Prometheus gọi service port tên `http`, path `/metrics`, mỗi 15 giây.

Nếu bị hỏi “sai port name thì sao?”:

> Prometheus sẽ không scrape được target vì ServiceMonitor tham chiếu port name không tồn tại.

## 36. Giải Thích Kỹ Các Trạng Thái Quan Trọng

### ArgoCD

```text
Synced
```

Cluster giống Git.

```text
OutOfSync
```

Cluster khác Git.

```text
Healthy
```

Resource đang hoạt động bình thường.

```text
Degraded
```

Resource có vấn đề về health. Trong bài này thường do Rollout bị abort.

```text
Sync failed
```

Một task sync fail. Nếu task fail là RolloutAborted thì đó là bản lỗi bị chặn đúng kịch bản.

### Argo Rollouts

```text
Healthy
```

Rollout ổn, bản hiện tại đã sẵn sàng.

```text
Progressing
```

Rollout đang cập nhật hoặc canary.

```text
Degraded
```

Rollout không đạt điều kiện, thường do analysis failed.

```text
RolloutAborted
```

Bản mới bị hủy.

```text
Stable RS
```

ReplicaSet ổn định đang phục vụ production.

```text
Current Pod Hash
```

ReplicaSet của bản đang thử/canary.

### AnalysisRun

```text
Successful
```

Metric đạt điều kiện.

```text
Failed
```

Metric không đạt, rollout có thể abort.

```text
Error
```

Có lỗi khi chạy analysis, ví dụ query Prometheus lỗi.

## 37. Kịch Bản Demo Chuẩn Khi Vấn Đáp

### Bước 1: Chứng minh GitOps app

```powershell
kubectl -n argocd get applications
```

Nói:

> Đây là các Application do ArgoCD quản lý. `root` quản lý app con, `web` quản lý workload, `kube-prometheus-stack` quản lý monitoring, `argo-rollouts` quản lý controller canary.

### Bước 2: Chứng minh monitoring chạy

```powershell
kubectl -n monitoring get pods
```

Nói:

> Prometheus, Grafana, Alertmanager đều Running nên hệ thống quan sát đã sẵn sàng.

### Bước 3: Chứng minh Rollouts controller chạy

```powershell
kubectl -n argo-rollouts get pods
```

Nói:

> Controller này xử lý resource `Rollout`, `AnalysisTemplate`, `AnalysisRun`.

### Bước 4: Chứng minh resource bài làm đầy đủ

```powershell
kubectl -n demo get rollouts.argoproj.io,svc,servicemonitor,prometheusrule,analysistemplate,pods
```

Nói:

> Namespace demo có đủ Rollout, Service, ServiceMonitor, PrometheusRule và AnalysisTemplate.

### Bước 5: Chứng minh bản lỗi bị abort

```powershell
kubectl -n demo describe rollout backend
kubectl -n demo get analysisrun
```

Tìm các dòng:

```text
RolloutAborted
Phase: Degraded
AnalysisRun Failed
Stable RS: ...
```

Nói:

> Bản lỗi có `ERROR_RATE=0.5`, AnalysisTemplate query Prometheus thấy error rate vượt 5%, nên AnalysisRun Failed và RolloutAborted.

### Bước 6: Chứng minh alert/email

```powershell
kubectl -n monitoring logs alertmanager-kube-prometheus-stack-alertmanager-0 -c alertmanager --tail=100
```

Hoặc mở Alertmanager:

```powershell
kubectl -n monitoring port-forward svc/kube-prometheus-stack-alertmanager 9093:9093
```

Nói:

> Alert `BackendHighErrorRate` được route đến receiver `personal-email`. Email dùng SMTP secret, không hard-code password vào Git.

## 38. Các Câu Hỏi Xoáy Và Cách Trả Lời

### Nếu Prometheus chết thì canary còn auto-abort không?

Không đầy đủ. AnalysisTemplate cần query Prometheus. Nếu Prometheus không phản hồi, AnalysisRun có thể Error và rollout không thể đánh giá chất lượng đúng cách.

### Vì sao không dùng CPU để làm SLO?

CPU là metric hạ tầng, không phản ánh trực tiếp trải nghiệm người dùng. SLO nên đo từ góc user, ví dụ request thành công, latency, error rate.

### Vì sao chọn error rate 5%?

Vì dễ chứng minh trong lab và là SLI phổ biến. Trong production, ngưỡng này phải dựa trên yêu cầu kinh doanh/SLA.

### Vì sao `ERROR_RATE=0.5` mà alert không luôn Firing?

Vì rollout có thể abort nhanh, làm traffic quay về bản tốt. Alert có `for: 1m`, nếu lỗi không kéo dài đủ 1 phút thì chỉ Pending rồi Inactive.

### Vì sao email không gửi dù alert Firing?

Kiểm tra Alertmanager logs. Nếu thấy `535`, lỗi SMTP username/app password. Nếu không có lỗi nhưng không thấy mail, kiểm tra Spam/Promotions hoặc repeat interval.

### Vì sao không commit secret thật?

Vì secret chứa password. Git là nơi chia sẻ lâu dài, đưa secret lên Git là rủi ro bảo mật. Chỉ commit file example.

### Khi app `web` Degraded thì có phải bài sai không?

Không nhất thiết. Nếu đang demo bản lỗi auto-abort, `Degraded` là bằng chứng bản lỗi bị chặn. Nhưng trạng thái cuối sau khi demo nên rollback về bản tốt để `web` Healthy.

### Nếu giảng viên hỏi “bản lỗi có rollback thật không?”

Trả lời:

> Có hai lớp bảo vệ. Thứ nhất, Argo Rollouts abort bản lỗi và giữ Stable ReplicaSet cũ. Thứ hai, nếu muốn đưa manifest Git về bản trước, em dùng `git revert` rồi ArgoCD sync lại.

## 39. Checklist Trạng Thái Cuối Nên Có

Sau khi chụp xong bản lỗi, nên đưa hệ thống về sạch:

```yaml
ERROR_RATE: "0"
```

Sau đó:

```powershell
git add k8s/web.yaml
git commit -m "restore healthy backend"
git push
kubectl -n argocd get app web
kubectl -n demo describe rollout backend
```

Kỳ vọng:

```text
web Synced Healthy
backend Phase: Healthy
AnalysisRun Successful
```

Giữ lại ảnh bản lỗi để chứng minh challenge, nhưng trạng thái cuối nên là Healthy để nhìn chuyên nghiệp hơn.
