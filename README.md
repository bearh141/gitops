# Hướng dẫn & Tài liệu Minh chứng (Evidence) - Tuần 9 Challenge

Dự án này là bài nộp tích hợp bài lab sáng (ứng dụng `web` frontend/backend) và bài lab chiều/challenge (Canary Auto-Abort & SLO Alerting cho ứng dụng `api`).

---

## 1. Giải thích Prometheus Query & Ngưỡng (Metrics & Thresholds)

### 1.1. Canary Analysis Template (`api-success-rate`)
Để tự động đánh giá sức khỏe của phiên bản mới (`Canary`) trong quá trình rollout, ta sử dụng một `AnalysisTemplate` đo tỷ lệ yêu cầu thành công (Success Rate).

* **Prometheus Query**:
  ```promql
  (sum(rate(flask_http_request_total{namespace="demo", status!~"5.."}[2m])) or vector(1))
  /
  (sum(rate(flask_http_request_total{namespace="demo"}[2m])) or vector(1))
  ```
* **Ý nghĩa query**:
  * Tử số: Tính tốc độ trung bình các request thành công (không có mã lỗi `5xx` như 500, 503...) trong vòng 2 phút qua (`[2m]`).
  * Mẫu số: Tổng số request gửi đến ứng dụng trong vòng 2 phút qua.
  * Sử dụng `or vector(1)` để trả về giá trị mặc định là `1` (100% thành công) nếu không có traffic nào, tránh lỗi chia cho 0 (`NaN`).
* **Ngưỡng đánh giá (Success Condition)**: `result[0] >= 0.95` (Tỉ lệ thành công lớn hơn hoặc bằng **95%**).
* **Cơ chế hoạt động**: Cứ mỗi 30 giây (`interval: 30s`), hệ thống sẽ chạy query trên. Nếu phát hiện success rate thấp hơn 95% quá 3 lần (`failureLimit: 3`), Rollout sẽ tự động **Abort** và rollback ngay lập tức về phiên bản ổn định trước đó.

### 1.2. SLO Alerting Rule (`BackendHighErrorRate`)
Cảnh báo này sẽ kích hoạt và gửi email khi tỷ lệ lỗi của ứng dụng `api` vượt quá ngưỡng quy định.

* **Prometheus Query**:
  ```promql
  (sum(increase(flask_http_request_total{namespace="demo", status=~"5.."}[1m])) or vector(0))
  /
  clamp_min((sum(increase(flask_http_request_total{namespace="demo"}[1m])) or vector(0)), 1)
  > 0.05
  ```
* **Ý nghĩa query**:
  * Tính tỉ lệ lỗi của ứng dụng trong cửa sổ trượt 1 phút (`[1m]`).
  * `clamp_min(..., 1)` đảm bảo mẫu số tối thiểu là 1 để tránh lỗi chia cho 0.
* **Ngưỡng cảnh báo (Threshold)**: `> 0.05` (Tỷ lệ lỗi lớn hơn **5%**).
* **Thời gian duy trì (Duration)**: `for: 1m` (Tỉ lệ lỗi phải liên tục duy trì trên 5% trong vòng 1 phút thì mới kích hoạt Alert).
* **Tích hợp Alertmanager**: Cảnh báo khi chuyển sang trạng thái `FIRING` sẽ được Alertmanager gửi trực tiếp tới email cấu hình (`dhoang1401@gmail.com`).

---

## 2. Hướng dẫn Lấy các File ảnh Minh chứng (Evidence Screenshots)

Dưới đây là danh sách chi tiết các hình ảnh bạn cần chụp để nộp bài:

### Hình 1: Giao diện ArgoCD chính của Cụm (Trạng thái Synced và Healthy)
* **Mục tiêu**: Chứng minh tất cả các ứng dụng (`root`, `web`, `api`, `argo-rollouts`, `kube-prometheus-stack`) đều đồng bộ sạch sẽ, không bị lệch cấu hình (no drift).
* **Cách thực hiện**:
  1. Mở trình duyệt truy cập vào dashboard Argo CD (qua port-forward cổng `8080`).
  2. Chụp toàn màn hình trang quản lý ứng dụng, hiển thị rõ cả 5 ứng dụng đều có nhãn màu xanh lá: **Synced** và **Healthy**.
* **Tên file gợi ý**: `01-argocd-synced-healthy.png`

### Hình 2: Minh chứng Canary Auto-Abort (Tự động Rollback khi gặp lỗi)
* **Mục tiêu**: Chứng minh hệ thống tự động phát hiện lỗi trên phiên bản Canary mới và tự động hủy rollout, trả về phiên bản ổn định cũ (`v2`).
* **Cách thực hiện**:
  1. Chạy lệnh sau trong terminal:
     ```bash
     kubectl describe rollout api -n demo
     ```
  2. Chụp lại phần log output ở terminal. Đặc biệt chú ý phần hiển thị:
     * `Message: RolloutAborted: Rollout aborted update to revision X`
     * `Metric "success-rate" assessed Failed due to failed (4) > failureLimit (3)`
     * Danh sách lịch sử events chứng minh quá trình abort/rollback tự động.
* **Tên file gợi ý**: `02-canary-auto-abort.png` (hoặc bạn có thể chụp giao diện Argo Rollouts Dashboard nếu có sử dụng plugin dashboard).

### Hình 3: Giao diện Prometheus Alerts (Trạng thái Firing)
* **Mục tiêu**: Chứng minh Alert Rule `BackendHighErrorRate` hoạt động đúng và đã kích hoạt cảnh báo khi lỗi được inject.
* **Cách thực hiện**:
  1. Port-forward Prometheus Server (qua port-forward cổng `9090`).
  2. Truy cập đường dẫn `http://localhost:9090/alerts`.
  3. Tìm alert `BackendHighErrorRate` và chụp ảnh giao diện hiển thị alert này đang ở trạng thái màu đỏ/cam: **FIRING**.
* **Tên file gợi ý**: `03-prometheus-alerts-firing.png`

### Hình 4: Email thông báo Cảnh báo từ Alertmanager
* **Mục tiêu**: Chứng minh Alertmanager gửi email cảnh báo SLO thành công đến email cá nhân.
* **Cách thực hiện**:
  1. Mở hộp thư cá nhân (`dhoang1401@gmail.com`).
  2. Tìm email có tiêu đề chứa `[FIRING]` hoặc `BackendHighErrorRate` gửi từ Alertmanager.
  3. Chụp lại nội dung email hiển thị chi tiết cảnh báo.
* **Tên file gợi ý**: `04-alert-email-notification.png`
