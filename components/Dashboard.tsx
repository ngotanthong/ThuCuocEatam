
import React, { useMemo, useState, useEffect } from 'react';
import { Bill } from '../types';
import { DollarSign, FileCheck, Target, Edit3, Save, TrendingUp, AlertCircle, CheckCircle2, XCircle, Clock, Zap, Calendar } from 'lucide-react';

interface DashboardProps {
  bills: Bill[];
}

// --- SUB-COMPONENT: BIỂU ĐỒ TRÒN CHUYÊN NGHIỆP (GRADIENT GAUGE) ---
const ProfessionalChart = ({ 
    percent, 
    color, 
    title, 
    valueDone, 
    valueRemains, 
    valueTarget,
    unit,
    isAutoTarget, 
    icon: Icon 
}: { 
    percent: number, 
    color: 'blue' | 'green', 
    title: string, 
    valueDone: string, 
    valueRemains: string, 
    valueTarget: string,
    unit: string,
    isAutoTarget: boolean,
    icon: any 
}) => {
    const size = 260; 
    const strokeWidth = 20;
    const center = size / 2;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    
    // Giới hạn percent từ 0 đến 100 để vẽ vòng tròn, nhưng hiển thị số thì vẫn để nguyên nếu > 100
    const drawPercent = Math.min(Math.max(percent, 0), 100);
    const offset = circumference - (drawPercent / 100) * circumference;

    const gradientId = `grad-${color}`;
    const startColor = color === 'blue' ? '#3b82f6' : '#22c55e'; 
    const endColor = color === 'blue' ? '#1d4ed8' : '#15803d';   
    const paleColor = color === 'blue' ? '#eff6ff' : '#f0fdf4';  
    const textColor = color === 'blue' ? 'text-blue-600' : 'text-green-600';
    const borderColor = color === 'blue' ? 'border-blue-100' : 'border-green-100';

    return (
        <div className={`bg-white rounded-2xl shadow-lg border ${borderColor} p-6 flex flex-col items-center relative overflow-hidden`}>
            {/* Header Card */}
            <div className="flex items-center gap-2 mb-4 self-start w-full border-b border-gray-100 pb-2">
                <div className={`p-2 rounded-lg ${paleColor}`}>
                    <Icon size={24} className={textColor} />
                </div>
                <div>
                    <h3 className="text-gray-500 text-xs font-bold uppercase tracking-wider">{title}</h3>
                    <div className="font-bold text-gray-800 text-lg">{valueDone} <span className="text-xs font-normal text-gray-400">/ {unit}</span></div>
                </div>
            </div>

            {/* Main Chart Area */}
            <div className="relative flex items-center justify-center py-4">
                <svg width={size} height={size} className="transform -rotate-90">
                    <defs>
                        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor={startColor} />
                            <stop offset="100%" stopColor={endColor} />
                        </linearGradient>
                    </defs>
                    {/* Track */}
                    <circle
                        cx={center} cy={center} r={radius}
                        stroke="#f3f4f6" strokeWidth={strokeWidth} fill="transparent"
                    />
                    {/* Progress with Gradient */}
                    <circle
                        cx={center} cy={center} r={radius}
                        stroke={`url(#${gradientId})`} strokeWidth={strokeWidth} fill="transparent"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        className="transition-all duration-1000 ease-out shadow-lg"
                        style={{ filter: `drop-shadow(0px 0px 6px ${startColor})` }}
                    />
                </svg>
                
                {/* Center Stats */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-gray-400 text-sm font-medium">Hoàn thành</span>
                    <span className={`text-5xl font-black ${textColor} tracking-tight`}>{percent.toFixed(1)}%</span>
                </div>
            </div>

            {/* Footer Stats Grid */}
            <div className="grid grid-cols-2 w-full gap-4 mt-4 pt-4 border-t border-dashed border-gray-200">
                <div className="flex flex-col items-center p-2 rounded bg-gray-50">
                    <span className="text-xs text-gray-500 font-semibold mb-1 flex items-center gap-1"><XCircle size={12}/> Còn lại (Tồn)</span>
                    <span className="text-lg font-bold text-gray-700">{valueRemains}</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded bg-blue-50/50 relative">
                    <span className="text-xs text-gray-500 font-semibold mb-1 flex items-center gap-1"><Target size={12}/> {isAutoTarget ? "Tổng danh sách" : "Chỉ tiêu KPI"}</span>
                    <span className="text-lg font-bold text-gray-700">{valueTarget}</span>
                    {isAutoTarget && (
                        <span className="absolute -top-2 -right-2 flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500"></span>
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};


const Dashboard: React.FC<DashboardProps> = ({ bills }) => {
  const [targetMoney, setTargetMoney] = useState<number>(0);
  const [targetCount, setTargetCount] = useState<number>(0);
  const [isEditingTarget, setIsEditingTarget] = useState(false);

  useEffect(() => {
    const savedTarget = localStorage.getItem('vnpt_dashboard_targets');
    if (savedTarget) {
        try {
            const parsed = JSON.parse(savedTarget);
            setTargetMoney(parsed.money || 0);
            setTargetCount(parsed.count || 0);
        } catch (e) { console.error("Lỗi đọc target", e); }
    }
  }, []);

  const handleSaveTarget = () => {
      localStorage.setItem('vnpt_dashboard_targets', JSON.stringify({ money: targetMoney, count: targetCount }));
      setIsEditingTarget(false);
  };

  const formatCurrency = (val: number) => {
     if (val >= 1000000000) return (val / 1000000000).toFixed(1) + ' tỷ';
     if (val >= 1000000) return (val / 1000000).toFixed(1) + ' tr';
     return val.toLocaleString('vi-VN');
  };

  const formatFullMoney = (val: number) => val.toLocaleString('vi-VN') + ' đ';

  // --- LOGIC THỐNG KÊ CỐT LÕI ---
  const stats = useMemo(() => {
    let paidCount = 0;
    let paidMoney = 0;
    let unpaidCount = 0;
    let unpaidMoney = 0;

    bills.forEach(b => {
        // Đã in (lastPrinted có giá trị) HOẶC Tổng tiền = 0 thì coi như xong (Đã thực hiện trên danh sách)
        if ((b.lastPrinted && b.lastPrinted.length > 0) || b.total === 0) {
            paidCount++;
            paidMoney += b.total;
        } else {
            unpaidCount++;
            unpaidMoney += b.total;
        }
    });
    return { paidCount, paidMoney, unpaidCount, unpaidMoney };
  }, [bills]);

  // --- LOGIC TÍNH TOÁN TIẾN ĐỘ (KPI) ---
  const progressStats = useMemo(() => {
     // 1. Nếu không nhập KPI: Mẫu số = Tổng danh sách thực tế
     // 2. Nếu CÓ nhập KPI: Mẫu số = KPI nhập vào
     
     const totalListMoney = stats.paidMoney + stats.unpaidMoney;
     const totalListCount = stats.paidCount + stats.unpaidCount;

     const effectiveTargetMoney = targetMoney > 0 ? targetMoney : totalListMoney;
     const effectiveTargetCount = targetCount > 0 ? targetCount : totalListCount;

     // 3. Tính số "Đã thực hiện" (Done)
     // QUY TẮC MỚI: Nếu có KPI thủ công -> Đã thực hiện = KPI - Tồn (Unpaid)
     // Giải thích: User muốn số liệu khớp với KPI tổng thể, coi như mọi thứ không nằm trong "Tồn" đều là "Đã xong".
     
     let displayMoneyDone = stats.paidMoney;
     let displayCountDone = stats.paidCount;

     if (targetMoney > 0) {
         // Logic suy diễn: Đã xong = Chỉ tiêu - Còn lại
         displayMoneyDone = Math.max(0, targetMoney - stats.unpaidMoney);
     }

     if (targetCount > 0) {
         // Logic suy diễn: Đã xong = Chỉ tiêu - Còn lại
         displayCountDone = Math.max(0, targetCount - stats.unpaidCount);
     }

     // 4. Tính %
     const moneyPercent = effectiveTargetMoney > 0 ? (displayMoneyDone / effectiveTargetMoney) * 100 : 0;
     const countPercent = effectiveTargetCount > 0 ? (displayCountDone / effectiveTargetCount) * 100 : 0;

     return { 
         moneyPercent, 
         countPercent,
         effectiveTargetMoney,
         effectiveTargetCount,
         displayMoneyDone, // Số tiền đã xong để hiển thị
         displayCountDone, // Số phiếu đã xong để hiển thị
         isAutoTargetMoney: targetMoney <= 0, 
         isAutoTargetCount: targetCount <= 0 
     };
  }, [targetMoney, targetCount, stats]);

  // --- LOGIC THỐNG KÊ HÔM NAY (QUAN TRỌNG) ---
  const todayStats = useMemo(() => {
      const now = new Date();
      // Tạo 2 dạng key để match với cả dữ liệu cũ và mới
      const d = now.getDate().toString().padStart(2, '0');
      const m = (now.getMonth() + 1).toString().padStart(2, '0');
      const y = now.getFullYear();
      
      const keyFull = `${d}/${m}/${y}`; // 05/03/2025 (Dạng mới)
      const keyShort = `${d}/${m}`;      // 05/03      (Dạng cũ)

      let count = 0;
      let money = 0;

      bills.forEach(b => {
          if (b.lastPrinted) {
              // Lấy phần ngày từ chuỗi "DD/MM/YYYY HH:mm"
              const datePart = b.lastPrinted.split(' ')[0];
              
              // So sánh linh hoạt
              if (datePart === keyFull || (datePart === keyShort && datePart.length === 5)) {
                  count++;
                  money += b.total;
              }
          }
      });
      return { count, money };
  }, [bills]); // useMemo sẽ tự chạy lại ngay lập tức khi bills thay đổi từ App.tsx

  // --- LOGIC LỊCH SỬ THỰC HIỆN ---
  const dailyStats = useMemo(() => {
    const groups: Record<string, { count: number, money: number }> = {};
    bills.forEach(b => {
      if (b.lastPrinted) {
        // Chuẩn hóa: Cắt lấy phần ngày tháng năm "DD/MM/YYYY" hoặc "DD/MM"
        const dateKey = b.lastPrinted.split(' ')[0]; 
        
        if (!groups[dateKey]) groups[dateKey] = { count: 0, money: 0 };
        groups[dateKey].count += 1;
        groups[dateKey].money += b.total;
      }
    });

    return Object.entries(groups)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => {
         // Parse ngày để sort
         const partsA = a.date.split('/').map(Number);
         const partsB = b.date.split('/').map(Number);
         
         const yearA = partsA.length === 3 ? partsA[2] : new Date().getFullYear();
         const yearB = partsB.length === 3 ? partsB[2] : new Date().getFullYear();
         
         if (yearA !== yearB) return yearB - yearA;
         if (partsA[1] !== partsB[1]) return partsB[1] - partsA[1];
         return partsB[0] - partsA[0];
      });
  }, [bills]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto bg-gray-50 min-h-screen space-y-8">
      
      {/* HEADER: KPI SETTING */}
      <div className="bg-gradient-to-r from-blue-800 to-blue-600 rounded-2xl shadow-xl text-white p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-32 bg-white opacity-5 rounded-full transform translate-x-10 -translate-y-10"></div>
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <h2 className="text-2xl font-bold flex items-center gap-2"><Target className="text-yellow-300"/> BẢNG ĐIỀU KHIỂN KPI</h2>
                <p className="text-blue-100 text-sm mt-1">
                    Thiết lập mục tiêu doanh số. <br/>
                    <span className="opacity-80 text-xs italic">(Hệ thống sẽ tự tính: Đã thu = Chỉ tiêu - Tồn)</span>
                </p>
            </div>
            
            <button 
                onClick={() => isEditingTarget ? handleSaveTarget() : setIsEditingTarget(true)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold shadow-md transition-all active:scale-95 ${isEditingTarget ? 'bg-yellow-400 text-blue-900 hover:bg-yellow-300' : 'bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm'}`}
            >
                {isEditingTarget ? <><Save size={18}/> LƯU CẤU HÌNH</> : <><Edit3 size={18}/> THIẾT LẬP KPI</>}
            </button>
        </div>

        {/* KPI INPUTS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div className={`bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20 transition-all ${isEditingTarget ? 'ring-2 ring-yellow-400 bg-white/20' : ''}`}>
                <div className="flex justify-between items-center mb-1">
                    <span className="text-blue-200 text-xs font-bold uppercase tracking-wider">Mục tiêu Doanh Thu</span>
                    <DollarSign size={16} className="text-blue-200"/>
                </div>
                {isEditingTarget ? (
                    <input 
                        type="number" 
                        value={targetMoney} 
                        onChange={e => setTargetMoney(Number(e.target.value))}
                        className="w-full bg-transparent text-2xl font-bold text-white outline-none border-b border-blue-300/50 focus:border-yellow-400 placeholder-blue-200"
                        placeholder="0 = Tự động theo DS"
                    />
                ) : (
                    <div className="text-3xl font-bold text-white tracking-tight">
                        {targetMoney > 0 ? formatFullMoney(targetMoney) : <span className="text-yellow-300 text-lg">Theo danh sách ({formatCurrency(progressStats.effectiveTargetMoney)})</span>}
                    </div>
                )}
            </div>

            <div className={`bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20 transition-all ${isEditingTarget ? 'ring-2 ring-yellow-400 bg-white/20' : ''}`}>
                <div className="flex justify-between items-center mb-1">
                    <span className="text-blue-200 text-xs font-bold uppercase tracking-wider">Mục tiêu Sản Lượng</span>
                    <FileCheck size={16} className="text-blue-200"/>
                </div>
                {isEditingTarget ? (
                    <input 
                        type="number" 
                        value={targetCount} 
                        onChange={e => setTargetCount(Number(e.target.value))}
                        className="w-full bg-transparent text-2xl font-bold text-white outline-none border-b border-blue-300/50 focus:border-yellow-400 placeholder-blue-200"
                        placeholder="0 = Tự động theo DS"
                    />
                ) : (
                    <div className="text-3xl font-bold text-white tracking-tight">
                         {targetCount > 0 ? targetCount.toLocaleString() : <span className="text-yellow-300 text-lg">Theo danh sách ({progressStats.effectiveTargetCount})</span>} 
                         {targetCount > 0 && <span className="text-lg font-normal text-blue-200 ml-1">phiếu</span>}
                    </div>
                )}
            </div>
        </div>
      </div>

      {/* CHARTS SECTION */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <ProfessionalChart 
            title="TIẾN ĐỘ DOANH THU"
            percent={progressStats.moneyPercent}
            color="blue"
            valueDone={formatFullMoney(progressStats.displayMoneyDone)}
            valueRemains={formatCurrency(stats.unpaidMoney)}
            valueTarget={formatCurrency(progressStats.effectiveTargetMoney)}
            isAutoTarget={progressStats.isAutoTargetMoney}
            unit="VNĐ"
            icon={DollarSign}
          />
          
          <ProfessionalChart 
            title="TIẾN ĐỘ SẢN LƯỢNG"
            percent={progressStats.countPercent}
            color="green"
            valueDone={progressStats.displayCountDone.toLocaleString()}
            valueRemains={stats.unpaidCount.toLocaleString()}
            valueTarget={progressStats.effectiveTargetCount.toLocaleString()}
            isAutoTarget={progressStats.isAutoTargetCount}
            unit="Phiếu"
            icon={CheckCircle2}
          />
      </div>

      {/* TODAY STATS SECTION */}
      <div className="bg-white rounded-2xl shadow-md border border-indigo-100 p-6 relative overflow-hidden">
         {/* Decorative BG */}
         <div className="absolute top-0 right-0 p-20 bg-indigo-50 rounded-bl-full opacity-60 -mr-10 -mt-10 pointer-events-none"></div>

         <div className="relative z-10">
             <div className="flex items-center gap-3 mb-6">
                 <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                    <Zap size={24} fill="currentColor" />
                 </div>
                 <div>
                     <h3 className="font-bold text-indigo-900 text-lg uppercase tracking-wide">Hiệu suất hôm nay</h3>
                     <p className="text-xs text-indigo-400 font-medium flex items-center gap-1">
                        <Calendar size={12}/> {new Date().toLocaleDateString('vi-VN')}
                     </p>
                 </div>
             </div>

             <div className="grid grid-cols-2 gap-8">
                 {/* Cột Tiền Hôm Nay */}
                 <div className="flex flex-col gap-1">
                     <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Doanh thu trong ngày</span>
                     <div className="text-3xl md:text-4xl font-black text-indigo-600 tracking-tighter">
                         {formatCurrency(todayStats.money)}
                     </div>
                 </div>

                 {/* Cột Phiếu Hôm Nay */}
                 <div className="flex flex-col gap-1 border-l-2 border-indigo-50 pl-8">
                     <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Đã thu được</span>
                     <div className="text-3xl md:text-4xl font-black text-indigo-600 tracking-tighter flex items-baseline gap-2">
                         {todayStats.count} <span className="text-sm font-bold text-gray-400">phiếu</span>
                     </div>
                 </div>
             </div>
         </div>
      </div>

      {/* HISTORY TABLE */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <TrendingUp className="text-blue-600"/> LỊCH SỬ THỰC HIỆN
            </h3>
            <span className="text-xs font-semibold text-gray-500 bg-white border border-gray-200 px-3 py-1 rounded-full shadow-sm">
                Cập nhật theo ngày in
            </span>
        </div>
        <div className="overflow-x-auto">
            {dailyStats.length === 0 ? (
                <div className="p-12 text-center text-gray-400 flex flex-col items-center">
                    <Clock size={48} className="mb-2 text-gray-300"/>
                    <p>Chưa có dữ liệu thực hiện.</p>
                </div>
            ) : (
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-100/50 text-gray-500 uppercase text-xs font-semibold">
                        <tr>
                            <th className="p-4 w-1/3">Ngày thực hiện</th>
                            <th className="p-4 text-center w-1/3">SL Hoàn thành</th>
                            <th className="p-4 text-right w-1/3">Doanh thu đạt được</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {dailyStats.map((d, idx) => (
                            <tr key={d.date} className={`hover:bg-blue-50/50 transition-colors ${idx === 0 ? 'bg-blue-50/20' : ''}`}>
                                <td className="p-4 font-bold text-gray-700 flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-blue-400"></div> {d.date}
                                    {(d.date === `${new Date().getDate().toString().padStart(2, '0')}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}` || 
                                      d.date === `${new Date().getDate().toString().padStart(2, '0')}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}/${new Date().getFullYear()}`) && (
                                        <span className="bg-indigo-100 text-indigo-600 text-[10px] px-2 py-0.5 rounded font-bold uppercase ml-2">Hôm nay</span>
                                    )}
                                </td>
                                <td className="p-4 text-center">
                                    <span className="inline-block bg-white border border-blue-100 text-blue-700 py-1 px-4 rounded-full text-xs font-bold shadow-sm">
                                        {d.count} phiếu
                                    </span>
                                </td>
                                <td className="p-4 text-right font-bold text-emerald-600 text-base">{formatFullMoney(d.money)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
      </div>

      <div className="h-10"></div>
    </div>
  );
};

export default Dashboard;
