// حساب يدوي
document.getElementById("btnCalc")?.addEventListener("click", async function () {
  const cost = parseFloat(document.getElementById("cost").value);
  const wastePercent = parseFloat(document.getElementById("waste").value);
  const fixedExpenses = parseFloat(document.getElementById("fixed").value);
  const profitPercent = parseFloat(document.getElementById("profit").value);
  const mode = document.querySelector("input[name='mode']:checked").value;

  const resp = await fetch('/api/calc-price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cost, wastePercent, fixedExpenses, profitPercent, profitMode: mode })
  });
  const data = await resp.json();
  document.getElementById("calcResult").innerText =
    `التكلفة بعد الهدر: ${data.costAfterWaste} | إجمالي: ${data.totalCost} | سعر المبيع: ${data.sellingPrice}`;
});

// رفع ملف Excel
document.getElementById("btnUpload")?.addEventListener("click", async function () {
  const input = document.getElementById("fileInput");
  if (!input.files.length) {
    alert("اختر ملف أولاً");
    return;
  }
  const file = input.files[0];
  const form = new FormData();
  form.append("file", file);

  const resp = await fetch("/api/upload-excel", { method: "POST", body: form });
  const data = await resp.json();

  const rows = data.rows || [];
  document.getElementById("uploadResult").innerText = `تمت معالجة ${rows.length} مادة`;

  renderTable(rows);
});

// عرض جدول
function renderTable(rows) {
  const container = document.getElementById("tableContainer");
  container.innerHTML = "";

  if (!rows.length) {
    container.innerText = "لا توجد بيانات";
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  const headers = Object.keys(rows[0]);
  const trh = document.createElement("tr");
  headers.forEach(h => {
    const th = document.createElement("th");
    th.innerText = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  rows.forEach(r => {
    const tr = document.createElement("tr");
    headers.forEach(h => {
      const td = document.createElement("td");
      td.innerText = r[h];
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);
}

// تحميل النتائج كملف Excel
document.getElementById("btnDownloadExcel")?.addEventListener("click", function () {
  const table = document.querySelector("#tableContainer table");
  if (!table) {
    alert("لا يوجد جدول!");
    return;
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(table);
  XLSX.utils.book_append_sheet(wb, ws, "Results");
  XLSX.writeFile(wb, "pricing-results.xlsx");
});
