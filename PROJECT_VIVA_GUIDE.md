# Cẩm Nang Ôn Thi Vấn Đáp - Tuần 9 (GitOps, Observability, Canary & SLO Alerting)

Tài liệu này được biên soạn chi tiết nhằm giúp bạn chuẩn bị tốt nhất cho buổi thi vấn đáp. Nó giải thích cặn kẽ từng tệp tin cấu hình (manifests), từng khối khai báo (blocks), và từng dòng code cốt lõi trong hệ thống bạn đã triển khai.

---

## PHẦN 1: BẢN ĐỒ KIẾN TRÚC & CƠ CHẾ HOẠT ĐỘNG

Trong vấn đáp, khi giảng viên yêu cầu **"Em hãy trình bày tổng quan dự án"**, hãy giải thích theo đúng luồng điều khiển sau:

```text
[Git / GitHub] (Source of truth)
      │
      ▼ (Auto-Sync)
[ArgoCD] (Đồng bộ trạng thái mong muốn vào Kubernetes cluster)
      │
      ▼ (Triển khai các Pods)
[Kubernetes Pods] (Ứng dụng "web" chạy cổng 3000, ứng dụng "api" chạy cổng 8080)
      │
      ├── Expose endpoint /metrics
      │
      ▼ (Thu thập dữ liệu mỗi 15 giây)
[Prometheus (kube-prometheus-stack)] (Thu thập nhờ ServiceMonitor)
      │
      ├── (Phát hiện lỗi vượt SLO 5% trong 10 giây) ──► [PrometheusRule] ──► [Alertmanager] ──► [Email dhoang1401@gmail.com]
      │
      └── (Đánh giá sức khỏe bản Canary mới) ──► [AnalysisTemplate] ──► [Argo Rollouts] ──► [Auto-Abort & Rollback về v2]
```

### Câu trả lời mẫu 1 phút (Nên học thuộc lòng):
> *"Bài làm của em xây dựng một pipeline triển khai an toàn theo mô hình **GitOps**. Em sử dụng **ArgoCD** để tự động đồng bộ cấu hình từ GitHub. Hệ thống gồm hai ứng dụng chính: ứng dụng **`web`** (frontend/backend ở bài lab sáng) và ứng dụng **`api`** (Flask API viết riêng ở bài challenge chiều). Cả hai ứng dụng đều expose metrics để **Prometheus** thu thập thông qua **ServiceMonitor**. 
> Em thiết lập SLO cho hệ thống là tỷ lệ lỗi không vượt quá 5%. Nếu có lỗi xảy ra kéo dài quá 10 giây, **PrometheusRule** sẽ phát hiện và **Alertmanager** sẽ gửi email cảnh báo về `dhoang1401@gmail.com`. 
> Đối với việc cập nhật phần mềm, em dùng **Argo Rollouts** chạy Canary. Bản mới được đưa lên thử nghiệm ở mức 25% traffic. Một **AnalysisTemplate** sẽ chạy liên tục để truy vấn Prometheus tính tỷ lệ thành công. Nếu tỷ lệ thành công của bản mới dưới 95% (giả lập khi inject `ERROR_RATE=0.4` ở phiên bản `v3`), hệ thống sẽ tự động **Abort** và rollback ngay lập tức về bản ổn định `v2` mà không cần con người can thiệp."*

---

## PHẦN 2: CHI TIẾT TỪNG FILE CẤU HÌNH (BLOCK-BY-BLOCK & LINE-BY-LINE)

### 1. File Root App: `argocd/root.yaml`
Đây là file áp dụng mô hình **App-of-Apps**. Bạn chỉ cần chạy lệnh `kubectl apply -f argocd/root.yaml` một lần duy nhất, ArgoCD sẽ tự động quét và tạo các ứng dụng con.

* **Chi tiết từng dòng quan trọng:**
  ```yaml
  apiVersion: argoproj.io/v1alpha1  # API Group của ArgoCD Custom Resource Definition
  kind: Application                 # Khai báo loại resource là một ứng dụng ArgoCD
  metadata:
    name: root                      # Tên của root application
    namespace: argocd               # Bắt buộc nằm trong namespace cài ArgoCD
  spec:
    project: default                # Thuộc project mặc định của ArgoCD
    source:
      repoURL: https://github.com/bearh141/gitops.git # Repo Git chứa toàn bộ code & manifests
      targetRevision: main          # Theo dõi nhánh main
      path: argocd/apps             # Thư mục chứa các tệp YAML định nghĩa các ứng dụng con
    destination:
      server: https://kubernetes.default.svc # Deploy trực tiếp vào cluster k8s hiện tại
      namespace: argocd             # Nơi lưu trữ tài nguyên Application con
    syncPolicy:
      automated:                    # Tự động đồng bộ
        prune: true                 # Nếu trên Git xóa file, trên K8s sẽ tự động xóa theo (Auto Pruning)
        selfHeal: true              # Nếu ai sửa tay trên K8s, ArgoCD sẽ tự động ghi đè về giống Git (Self Healing)
  ```

* **Phân tích kỹ khối `syncPolicy`:**
  * **`prune: true`**: Khi bạn xóa một file manifest khỏi thư mục Git, ArgoCD phát hiện nó không còn trong Git nữa và sẽ tự động ra lệnh xóa tài nguyên tương ứng trên Kubernetes cluster. Nếu thiếu, tài nguyên cũ bị xóa trên Git vẫn sẽ tồn tại mãi trên cụm.
  * **`selfHeal: true`**: Cơ chế chống sửa tay (Drift Detection). Nếu ai đó dùng lệnh `kubectl edit` sửa cấu hình trực tiếp trên cụm, ArgoCD sẽ ngay lập tức phát hiện sự sai lệch và ghi đè lại cấu hình ban đầu từ Git trong vài giây.

---

### 2. File App Definition cho API: `argocd/apps/api.yaml`
File này khai báo cho ArgoCD biết ứng dụng `api` (chứa canary rollout) nằm ở đâu trong Repo.

* **Chi tiết từng dòng quan trọng:**
  ```yaml
  apiVersion: argoproj.io/v1alpha1
  kind: Application
  metadata:
    name: api
    namespace: argocd
  spec:
    project: default
    source:
      repoURL: https://github.com/bearh141/gitops.git
      targetRevision: main
      path: k8s-api                 # Trỏ đến thư mục chứa các tài nguyên của API app (Rollout, Service, ServiceMonitor, PrometheusRule, AnalysisTemplate)
    destination:
      server: https://kubernetes.default.svc
      namespace: demo               # Ứng dụng nghiệp vụ sẽ được deploy vào namespace "demo"
    syncPolicy:
      automated:
        prune: true
        selfHeal: true
      syncOptions:
        - CreateNamespace=true      # Tự động tạo namespace "demo" nếu trong cụm chưa có
  ```

---

### 3. File Cấu Hìng Rollout & Service: `k8s-api/api.yaml`
Đây là trung tâm của bài chiều. File này định nghĩa cách triển khai pod ứng dụng `api` sử dụng chiến lược **Canary** thay vì Deployment thông thường.

* **Block 1: Trình điều khiển Rollout (Dòng 1 - 53)**
  ```yaml
  apiVersion: argoproj.io/v1alpha1
  kind: Rollout                     # Không dùng Deployment, dùng Rollout của Argo Rollouts
  metadata:
    name: api
    namespace: demo
    labels:
      app: api
    annotations:
      argocd.argoproj.io/sync-wave: "1" # Được deploy ở Wave 1 (sau Namespace và AnalysisTemplate)
  spec:
    replicas: 4                     # Tổng số bản sao (pod) khi ứng dụng chạy ổn định ở 100%
    selector:
      matchLabels:
        app: api                    # Nhãn để Rollout quản lý các Pod
    template:                       # Định nghĩa Pod template giống hệt Deployment
      metadata:
        labels:
          app: api
      spec:
        containers:
          - name: api
            image: w9-api:1         # Image ứng dụng Flask API tự build
            imagePullPolicy: IfNotPresent
            ports:
              - name: http
                containerPort: 8080 # App Flask lắng nghe ở cổng 8080
            env:
              - name: ERROR_RATE
                value: "0"          # Biến môi trường giả lập tỷ lệ lỗi (0 = không lỗi, 0.4 = lỗi 40%)
              - name: VERSION
                value: "v2"         # Phiên bản ứng dụng hiện tại
              - name: RETRY_ID
                value: "1"          # Biến phụ dùng để kích hoạt rollout chạy lại khi cần thiết
            readinessProbe:         # Probe kiểm tra pod đã sẵn sàng nhận traffic chưa
              httpGet:
                path: /healthz      # Endpoint healthcheck của app Flask
                port: 8080
              initialDelaySeconds: 3
              periodSeconds: 5
    strategy:
      canary:                       # Sử dụng chiến lược triển khai Canary
        analysis:
          templates:
            - templateName: api-success-rate # Chạy phân tích liên tục sử dụng AnalysisTemplate này
        steps:
          - setWeight: 25           # Bước 1: Mở 25% traffic cho bản mới (v3), 75% vẫn chạy bản cũ (v2)
          - pause:
              duration: 1m          # Bước 2: Dừng lại 1 phút để chạy Analysis kiểm tra sức khỏe
          - setWeight: 50           # Bước 3: Nếu đạt, nâng lên 50% traffic cho bản mới
          - pause:
              duration: 1m          # Bước 4: Tiếp tục dừng 1 phút để kiểm tra tiếp
          - setWeight: 100          # Bước 5: Nếu tất cả đều đạt, chuyển 100% traffic và hoàn tất
  ```

* **Phân tích kỹ chiến lược Canary:**
  * **`analysis`**: Liên kết đợt cập nhật này với một **AnalysisTemplate** chạy ngầm (Background Analysis). Nghĩa là ngay khi bắt đầu bước đầu tiên (`setWeight: 25`), Argo Rollouts sẽ tạo ra một tài nguyên thực thi gọi là `AnalysisRun` để liên tục truy vấn Prometheus để đo đạc chất lượng của các pod mới.
  * **`steps`**: Quy trình triển khai. Nếu bất kỳ lúc nào trong các khoảng thời gian dừng (`pause`) mà `AnalysisRun` phát hiện tỉ lệ lỗi vượt ngưỡng, quá trình chạy các bước này sẽ lập tức dừng lại và kích hoạt **Auto-Abort** (tự động rollback về bản cũ).

* **Block 2: Service K8s (Dòng 55 - 71)**
  ```yaml
  apiVersion: v1
  kind: Service
  metadata:
    name: api
    namespace: demo
    annotations:
      argocd.argoproj.io/sync-wave: "2" # Deploy ở Wave 2 (sau khi Rollout đã được khai báo)
  spec:
    selector:
      app: api                      # Định tuyến traffic đến các pod có nhãn app=api
    ports:
      - name: http
        port: 8080                  # Cổng của Service
        targetPort: 8080            # Cổng thực tế trong Container
  ```

---

### 4. File Phân Tích Chỉ Số Canary: `k8s-api/analysis.yaml`
Tệp này định nghĩa cách thức hệ thống tự động kiểm tra xem phiên bản mới có đạt chất lượng hay không bằng cách gửi truy vấn trực tiếp đến Prometheus.

* **Chi tiết cấu hình:**
  ```yaml
  apiVersion: argoproj.io/v1alpha1
  kind: AnalysisTemplate            # Resource quy định mẫu phân tích
  metadata:
    name: api-success-rate          # Tên mẫu, được tham chiếu trong file api.yaml
    namespace: demo
  spec:
    metrics:
      - name: success-rate          # Tên metric tự định nghĩa
        interval: 30s               # Cứ mỗi 30 giây chạy query Prometheus một lần
        successCondition: result[0] >= 0.95 # Điều kiện thành công: tỷ lệ thành công >= 95%
        failureLimit: 3             # Cho phép thất bại tối đa 3 lần. Lần thứ 4 không đạt sẽ Abort
        provider:
          prometheus:               # Sử dụng nguồn dữ liệu Prometheus
            address: http://kube-prometheus-stack-prometheus.monitoring.svc:9090 # URL kết nối đến Prometheus Server trong cluster
            query: |                # Câu lệnh PromQL tính tỷ lệ thành công của ứng dụng
              (sum(rate(flask_http_request_total{namespace="demo", status!~"5.."}[2m])) or vector(1))
              /
              (sum(rate(flask_http_request_total{namespace="demo"}[2m])) or vector(1))
  ```

* **Phân tích kỹ các tham số trong Analysis Metric:**
  * **`successCondition: result[0] >= 0.95`**: `result[0]` là giá trị số thực trả về từ câu lệnh PromQL. Giá trị này nằm trong khoảng từ `0.0` (0%) đến `1.0` (100%). Nếu kết quả trả về `< 0.95` (tức là tỷ lệ thành công dưới 95% do có lỗi `5xx`), lần kiểm tra đó sẽ bị đánh dấu là **Failed**.
  * **`failureLimit: 3`**: Cho phép đo hỏng tối đa 3 lần. Việc này giúp tránh trường hợp hệ thống bị lag nhất thời làm tụt chỉ số trong vài giây rồi phục hồi. Nhưng nếu đo hỏng liên tiếp 4 lần, hệ thống sẽ kết luận bản mới không an toàn và tự hủy.
  * **Giải thích chi tiết câu lệnh PromQL trong Analysis:**
    * `flask_http_request_total`: Metric đếm tổng request của app Flask.
    * `{namespace="demo", status!~"5.."}`: Chỉ lọc các request thuộc namespace `demo` và có HTTP status **không phải** `5xx` (tức là loại bỏ các lỗi Server Error 500 để lấy số request thành công).
    * `rate(...[2m])`: Tính toán tốc độ request trung bình trong cửa sổ thời gian trượt (sliding window) dài 2 phút.
    * `sum(...)`: Cộng gộp chỉ số từ tất cả các pod đang chạy.
    * `or vector(1)`: Nếu hệ thống chưa có request nào (rate = 0), Prometheus sẽ trả về giá trị mặc định là `1` (tương đương 100% thành công) để tránh lỗi không chia được cho 0.
    * Phép chia `/`: Chia số request thành công cho tổng số request để tính ra tỉ lệ thành công (từ 0.0 đến 1.0).

---

### 5. File Định Nghĩa Cảnh Báo SLO: `k8s-api/prometheusrule.yaml`
Tệp này định nghĩa cảnh báo khi tỷ lệ lỗi vượt quá mức cho phép trong một khoảng thời gian nhất định.

* **Chi tiết cấu hình:**
  ```yaml
  apiVersion: monitoring.coreos.com/v1
  kind: PrometheusRule              # Resource của Prometheus Operator để định nghĩa Alert Rule
  metadata:
    name: api-slo-alerts
    namespace: demo
    labels:
      release: kube-prometheus-stack # Bắt buộc phải trùng với label release của Prometheus để được phát hiện
  spec:
    groups:
      - name: api-slo               # Tên nhóm alert
        rules:
          - alert: BackendHighErrorRate # Tên của Alert
            expr: |                 # Biểu thức PromQL đo tỷ lệ lỗi
              (
                (sum(increase(flask_http_request_total{namespace="demo", status=~"5.."}[1m])) or vector(0))
                /
                clamp_min((sum(increase(flask_http_request_total{namespace="demo"}[1m])) or vector(0)), 1)
              ) > 0.05              # Kiểm tra xem tỷ lệ lỗi có lớn hơn 5% (0.05) hay không
            for: 10s                # Điều kiện lỗi phải kéo dài liên tục 10 giây mới phát báo động Firing
            labels:
              severity: warning     # Độ nghiêm trọng của cảnh báo
            annotations:
              summary: "API error rate is above SLO"
              description: "More than 5% of API requests are failing in the demo namespace."
  ```

* **Phân tích kỹ các tham số trong Alerting Rule:**
  * **`expr: (...) > 0.05`**: Prometheus sẽ liên tục đánh giá biểu thức này. Nếu tỷ lệ lỗi tính ra lớn hơn `0.05` (5%), biểu thức này trả về kết quả `true`.
  * **`for: 10s`**: Thời gian chờ. Khi biểu thức trả về `true`, Alert sẽ chuyển sang trạng thái **`PENDING`** (Đang chờ). Nếu lỗi vẫn duy trì liên tục đủ 10 giây, Alert mới chính thức chuyển sang trạng thái **`FIRING`** (Đang báo động) để kích hoạt email. Nếu lỗi tự hết trước 10 giây (ví dụ do Canary tự hủy nhanh), alert sẽ biến mất và không làm phiền người quản trị.
  * **Giải thích chi tiết câu lệnh PromQL trong PrometheusRule:**
    * `status=~"5.."`: Chỉ lấy các request bị lỗi `5xx`.
    * `increase(...[1m])`: Lấy số lượng request tăng thêm trong vòng 1 phút qua.
    * `clamp_min(..., 1)`: Hàm này giới hạn giá trị tối thiểu của mẫu số là `1`, ngăn cản lỗi chia cho 0 khi không có traffic.
    * Toán tử so sánh `> 0.05`: Trả về kết quả (để bắn alert) nếu tỷ lệ lỗi lớn hơn 5%.

---

### 6. File Giám Sát Service: `k8s-api/servicemonitor.yaml`
ServiceMonitor là cấu hình khai báo giúp Prometheus tự động phát hiện và thu thập metrics từ Service của bạn.

* **Chi tiết cấu hình:**
  ```yaml
  apiVersion: monitoring.coreos.com/v1
  kind: ServiceMonitor              # Loại tài nguyên ServiceMonitor
  metadata:
    name: api
    namespace: demo
    labels:
      release: kube-prometheus-stack # Nhãn kết nối với Prometheus stack
    annotations:
      argocd.argoproj.io/sync-wave: "3" # Deploy ở wave 3
  spec:
    namespaceSelector:
      matchNames:
        - demo                      # Chỉ tìm các Service trong namespace "demo"
    selector:
      matchLabels:
        app: api                    # Chỉ scrape các Service có nhãn app=api
    endpoints:
      - port: http                  # Tên cổng cần scrape (phải khớp với name: http trong Service)
        path: /metrics              # Đường dẫn endpoint lấy metrics của Flask
        interval: 15s               # Cứ mỗi 15 giây Prometheus sẽ kéo dữ liệu một lần
  ```

* **Phân tích kỹ các tham số trong ServiceMonitor:**
  * **`matchLabels: { app: api }`**: Đây là bộ lọc. Prometheus sẽ tìm kiếm trong namespace `demo` xem có Service nào khai báo label `app: api` trong phần `metadata.labels` hay không. Nếu trùng khớp, nó mới tiến hành thu thập.
  * **`port: http`**: Prometheus không kết nối trực tiếp vào số cổng (ví dụ: 8080) mà kết nối dựa trên **tên cổng (port name)** được khai báo trong tệp tin Service. Nếu đặt tên cổng không trùng khớp, Prometheus sẽ không thể tìm thấy endpoints.

---

## PHẦN 3: CÁC CÂU HỎI XOÁY CỦA GIẢNG VIÊN & CÁCH TRẢ LỜI

#### ❓ Câu hỏi 1: Tại sao em lại thiết lập các Sync-Wave (`sync-wave: "-1"`, `"1"`, `"2"`, `"3"`) trong các manifest? Nếu không cấu hình thì bị lỗi gì?
* **Trả lời:** Sync-Wave giúp điều khiển thứ tự khởi tạo tài nguyên trong ArgoCD:
  * Nếu không có Sync-Wave, ArgoCD sẽ apply tất cả các file đồng thời.
  * Hậu quả: Nếu `Rollout` được tạo ra trước khi `AnalysisTemplate` kịp tồn tại trong cluster, Rollout sẽ bị lỗi vì không tìm thấy Template tham chiếu. Tương tự, nếu `ServiceMonitor` được tạo ra trước khi `Service` hoặc `Namespace` tồn tại, nó sẽ bị lỗi. Cấu hình Sync-Wave đảm bảo quá trình cài đặt diễn ra tuần tự và an toàn.

#### ❓ Câu hỏi 2: Tại sao khi inject lỗi (`ERROR_RATE=0.4`) thì lúc Rollout bị abort và rollback, ứng dụng lại báo trạng thái `Degraded` trên ArgoCD? Trạng thái đó có phải là lỗi hệ thống không?
* **Trả lời:** Không phải lỗi cấu hình hệ thống, đó là **hoạt động hoàn toàn đúng thiết kế**:
  * Khi bản mới có 40% lỗi, chỉ số Success Rate giảm dưới 95%.
  * `AnalysisRun` đánh giá thất bại (Failed), Argo Rollouts lập tức phát lệnh **Abort** để dừng cập nhật và phục hồi phiên bản ổn định cũ (`v2`).
  * Vì đợt triển khai phiên bản mới bị hủy bỏ giữa chừng, Argo Rollouts controller báo trạng thái của Rollout là `Degraded` để quản trị viên biết đợt deploy vừa rồi đã thất bại và hệ thống đã chủ động rollback. Khi chúng ta khôi phục lại cấu hình an toàn trên Git (`ERROR_RATE=0`), Rollout sẽ hoàn thành đồng bộ và quay lại trạng thái `Healthy`.

#### ❓ Câu hỏi 3: Nếu Prometheus Server bị sập (Crash) thì cơ chế Canary Rollout có hoạt động được nữa không?
* **Trả lời:** Không hoạt động đúng. Vì `AnalysisTemplate` sử dụng nhà cung cấp dữ liệu (provider) là Prometheus. Nếu Prometheus sập, AnalysisRun khi query sẽ nhận lỗi kết nối (trạng thái `Error`). Rollout không nhận được dữ liệu để chứng minh bản mới an toàn, do đó sẽ không thể tự động tiến tới bước tiếp theo (hoặc sẽ bị kẹt hoặc tự hủy tùy thuộc cấu hình xử lý lỗi).

#### ❓ Câu hỏi 4: Tại sao em lại cấu hình tham số `for: 10s` trong PrometheusRule mà không để lâu hơn?
* **Trả lời:** Trong các môi trường thực tế (Production), tham số `for` thường là `1m` hoặc `5m` để tránh các cảnh báo giả do mạng chập chờn nhất thời. Tuy nhiên, trong bài Lab/Challenge thi, chúng ta cần chứng minh Alert hoạt động nhanh chóng, nên em để `for: 10s` để ngay khi có lỗi phát sinh, Alertmanager lập tức chuyển trạng thái sang `FIRING` và gửi email cho giảng viên thấy ngay kết quả mà không cần chờ đợi lâu.

#### ❓ Câu hỏi 5: Em cấu hình thông tin SMTP password để gửi email của Alertmanager ở đâu? Có được đẩy lên Git không?
* **Trả lời:** Để bảo mật, em không đẩy mật khẩu Gmail thật lên Git (chỉ đẩy file mẫu [alertmanager-smtp-secret.example.yaml](file:///d:/Download/AWS/H%E1%BB%8Dc/cloud/cloud/w9/lab/gitops/k8s/alertmanager-smtp-secret.example.yaml) với giá trị rỗng). Mật khẩu ứng dụng Gmail (App Password) thực tế được tạo và áp dụng trực tiếp vào Kubernetes cluster dưới dạng một `Secret` bảo mật tên là `alertmanager-smtp` trong namespace `monitoring` bằng dòng lệnh thủ công. File secret này đã được khai báo trong `.gitignore` để ngăn chặn việc vô tình đẩy lên GitHub.

---

## PHẦN 4: KỊCH BẢN DEMO THỰC TẾ TRONG BUỔI VẤN ĐÁP (5 BƯỚC)

Nếu thầy cô bảo **"Em chạy demo cho thầy/cô xem luồng Canary tự hủy khi có lỗi đi"**, hãy làm đúng theo 5 bước sau:

* **Bước 1: Show trạng thái xanh sạch ban đầu**
  Show màn hình ArgoCD hiển thị cả 5 app đều **Synced** và **Healthy**.
  Chạy lệnh chứng minh Rollout `api` đang ở revision ổn định:
  ```bash
  kubectl describe rollout api -n demo
  ```

* **Bước 2: Sửa Git để cấy lỗi (Inject Error)**
  Mở file `k8s-api/api.yaml`, sửa `VERSION` lên `"v3"` và `ERROR_RATE` lên `"0.4"`.
  Thực hiện commit và push:
  ```bash
  git add k8s-api/api.yaml
  git commit -m "deploy faulty version v3"
  git push
  ```

* **Bước 3: Show ArgoCD nhận diện và bắt đầu Canary**
  Chỉ cho thầy cô thấy ArgoCD tự động Sync, tạo ra các pod mới của revision `v3` và chuyển 25% traffic sang pod này.

* **Bước 4: Show quá trình Auto-Abort**
  Chạy lệnh theo dõi Rollout:
  ```bash
  kubectl describe rollout api -n demo
  ```
  Chỉ cho thầy cô thấy phần `AnalysisRun` bắt đầu ghi nhận thất bại vì tỉ lệ thành công không đạt 95%. Sau 4 lần đo thất bại, Rollout sẽ tự chuyển sang `Phase: Degraded` và hiển thị thông báo `RolloutAborted`. Các pod lỗi phiên bản `v3` tự động bị Terminate và 100% traffic quay về bản `v2`.

* **Bước 5: Show Email cảnh báo lỗi**
  Mở Gmail `dhoang1401@gmail.com` và chỉ cho thầy cô thấy email Alertmanager vừa gửi tới cảnh báo lỗi `BackendHighErrorRate`.
