
import React, { useEffect, useState, useRef, useMemo, useDeferredValue } from 'react';
import { Bill } from './types';
import { getBills, saveBills } from './services/billService';
import { getSheetConfig, saveSheetConfig, fetchBillsFromAPI, updateBillAPI, addBillAPI, SheetConfig, addToSyncQueue, processSyncQueue, getSyncQueue } from './services/sheetService';
import { connectPrinter, printBillBluetooth, printPaymentQR, printFaultReport, disconnectPrinter } from './services/bluetoothPrinter';
import Receipt from './components/Receipt';
import Dashboard from './components/Dashboard';
import { Printer, Search, FileText, X, Loader2, Bluetooth, Upload, Trash2, ClipboardPaste, Download, LayoutDashboard, List, Info, Save, MapPin, DollarSign, Plus, QrCode, Map as MapIcon, Navigation, AlertTriangle, Settings, Cloud, CloudOff, RefreshCw, Link as LinkIcon, Phone, Hash, Wifi, WifiOff, StickyNote, Signal, Satellite, ChevronLeft, ArrowDownWideNarrow, EyeOff, Wrench, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import L from 'leaflet';

// --- UTILS ---

const removeAccents = (str: string): string => {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "D")
        .toLowerCase();
};

const getCoordsFromLink = (link?: string): [number, number] | null => {
    if (!link) return null;
    try {
        const regex = /(?:q=|@)(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)/;
        const match = link.match(regex);
        if (match) {
            return [parseFloat(match[1]), parseFloat(match[3])];
        }
        return null;
    } catch (e) {
        return null;
    }
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const sanitizeBills = (data: any[]): Bill[] => {
    return (data || []).filter(b => b).map(b => ({
        ...b,
        customerName: b.customerName || '',
        period: b.period || '',
        subscriberNumber: b.subscriberNumber || '',
        address: b.address || '',
        location: b.location || '',
        qrLink: b.qrLink || '',
        phone: b.phone || '',
        paymentCode: b.paymentCode || '',
        note: b.note || '',
        staff: {
            code: b.staff?.code || '',
            name: b.staff?.name || '',
            phone: b.staff?.phone || ''
        },
        status: b.status || ''
    }));
};

// --- SUB-COMPONENT: MAP TAB ---
interface MapTabProps {
    bills: Bill[];
    userLocation: { lat: number, lng: number, heading?: number | null } | null; // Receive live location from App
    onBillClick: (bill: Bill) => void;
    onEditBill: (bill: Bill) => void;
    onUpdateBill: (id: string, updates: Partial<Bill>) => void;
    onPrintQR: (bill: Bill) => void;
}

const MapTab: React.FC<MapTabProps> = ({ bills, userLocation, onBillClick, onEditBill, onUpdateBill, onPrintQR }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const leafletMap = useRef<L.Map | null>(null);
    const markersRef = useRef<L.Marker[]>([]);
    const userMarkerRef = useRef<L.Marker | null>(null); // Ref for user marker
    const [sortedBills, setSortedBills] = useState<(Bill & { distance: number, lat: number, lng: number })[]>([]);
    const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
    const [isFollowing, setIsFollowing] = useState(true); // Auto-center state
    const [mapType, setMapType] = useState<'street' | 'satellite'>('street');
    const tileLayerRef = useRef<L.TileLayer | null>(null);

    // 1. Calculate Distances & Filter
    useEffect(() => {
        const mappable = bills.map(b => {
            const coords = getCoordsFromLink(b.location);
            if (!coords) return null;
            if (!!b.lastPrinted || b.total === 0) {
                return null;
            }
            let dist = 999999;
            if (userLocation) {
                dist = calculateDistance(userLocation.lat, userLocation.lng, coords[0], coords[1]);
            }
            return { ...b, lat: coords[0], lng: coords[1], distance: dist };
        }).filter(b => b !== null) as (Bill & { distance: number, lat: number, lng: number })[];

        if (userLocation) {
            mappable.sort((a, b) => a.distance - b.distance);
        }
        setSortedBills(mappable);
    }, [bills, userLocation]);

    // 2. Init Map
    useEffect(() => {
        if (!mapRef.current) return;
        if (leafletMap.current) leafletMap.current.remove();

        const map = L.map(mapRef.current).setView([12.666, 108.038], 13);
        leafletMap.current = map;

        // Initial Tile Layer
        const streetUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        const satelliteUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

        tileLayerRef.current = L.tileLayer(mapType === 'street' ? streetUrl : satelliteUrl, {
            attribution: mapType === 'street' ? '&copy; OpenStreetMap contributors' : 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        }).addTo(map);

        // Disable follow on drag
        map.on('dragstart', () => setIsFollowing(false));

        const timer = setTimeout(() => { map.invalidateSize(); }, 200);
        return () => {
            clearTimeout(timer);
            if (leafletMap.current) {
                leafletMap.current.remove();
                leafletMap.current = null;
            }
        };
    }, []); // Run once on mount

    // Handle Map Type Change
    useEffect(() => {
        if (!leafletMap.current || !tileLayerRef.current) return;

        const streetUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        const satelliteUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

        tileLayerRef.current.setUrl(mapType === 'street' ? streetUrl : satelliteUrl);
    }, [mapType]);

    // 3. Update User Marker Live & Auto Center
    useEffect(() => {
        if (!leafletMap.current) return;

        if (userLocation) {
            const userLatLng: [number, number] = [userLocation.lat, userLocation.lng];
            const heading = userLocation.heading || 0;

            if (userMarkerRef.current) {
                userMarkerRef.current.setLatLng(userLatLng);
                // Update rotation if marker element exists
                const iconElement = userMarkerRef.current.getElement();
                if (iconElement) {
                    const arrow = iconElement.querySelector('.nav-arrow') as HTMLElement;
                    if (arrow) {
                        arrow.style.transform = `rotate(${heading}deg)`;
                    }
                }
            } else {
                // Navigation Arrow Icon
                const userIcon = L.divIcon({
                    className: 'custom-user-icon',
                    html: `
                        <div class="nav-arrow" style="
                            width: 0; 
                            height: 0; 
                            border-left: 10px solid transparent;
                            border-right: 10px solid transparent;
                            border-bottom: 24px solid #3b82f6;
                            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
                            transform: rotate(${heading}deg);
                            transition: transform 0.3s ease;
                            position: relative;
                        ">
                            <div style="
                                position: absolute;
                                top: 24px;
                                left: -10px;
                                width: 20px;
                                height: 20px;
                                background: rgba(59, 130, 246, 0.3);
                                border-radius: 50%;
                                transform: translate(0, -50%);
                                z-index: -1;
                            "></div>
                        </div>
                    `,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                });
                userMarkerRef.current = L.marker(userLatLng, { icon: userIcon, zIndexOffset: 1000 }).addTo(leafletMap.current);
                userMarkerRef.current.bindPopup("<b>Vị trí của bạn</b>");
            }

            // Auto-center logic
            if (isFollowing) {
                leafletMap.current.setView(userLatLng, leafletMap.current.getZoom(), { animate: true });
            }
        }
    }, [userLocation, isFollowing]);

    // 4. Update Bill Markers
    useEffect(() => {
        if (!leafletMap.current) return;
        const map = leafletMap.current;

        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        sortedBills.forEach(bill => {
            const isSelected = bill.id === selectedBillId;
            let color = '#ea580c';
            let size = 24;
            let zIndex = 1;

            if (isSelected) {
                color = '#ef4444'; // Brighter Red
                size = 40; // Much bigger
                zIndex = 999;
            } else if (bill.status && bill.status.length > 0) {
                color = '#7c3aed';
            }

            const markerHtml = `
                <div style="
                    background-color: ${color};
                    width: ${size}px; height: ${size}px;
                    border-radius: 50% 50% 50% 0;
                    transform: rotate(-45deg);
                    border: ${isSelected ? '4px' : '2px'} solid white;
                    display: flex; align-items: center; justify-content: center;
                    box-shadow: ${isSelected ? '0 0 0 4px rgba(239, 68, 68, 0.4)' : '2px 2px 4px rgba(0,0,0,0.3)'};
                    transition: all 0.3s ease;
                ">
                    <div style="width: ${size / 3}px; height: ${size / 3}px; background: white; border-radius: 50%;"></div>
                </div>
            `;

            const icon = L.divIcon({
                className: 'custom-pin',
                html: markerHtml,
                iconSize: [size, size],
                iconAnchor: [size / 2, size], // Tip of the pin
                popupAnchor: [0, -size]
            });

            const marker = L.marker([bill.lat, bill.lng], { icon, zIndexOffset: zIndex }).addTo(map);

            const popupContent = `
                <div class="text-sm min-w-[200px]">
                    <div class="font-bold text-blue-700 text-base">${bill.customerName}</div>
                    <div class="text-xs text-gray-600 mb-2">${bill.address}</div>
                    <div class="font-bold text-red-600 text-lg mb-2">${bill.total.toLocaleString()} đ</div>
                    ${bill.status ? `<div class="text-xs font-bold text-purple-600 mb-2">⚠️ ${bill.status}</div>` : ''}
                    <a href="https://www.google.com/maps/dir/?api=1&destination=${bill.lat},${bill.lng}" target="_blank" 
                       class="block w-full bg-blue-600 text-white text-center py-2 rounded font-bold text-xs hover:bg-blue-700 transition-colors flex items-center justify-center gap-1">
                       📍 Chỉ đường (Google Maps)
                    </a>
                </div>
            `;
            marker.bindPopup(popupContent);
            marker.on('click', () => {
                setSelectedBillId(bill.id);
                setIsFollowing(false); // Stop following user when clicking a pin to view it
                document.getElementById(`bill-card-${bill.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            markersRef.current.push(marker);
        });

        // Initial fit bounds if not following user and no selection
        if (markersRef.current.length > 0 && !selectedBillId && !userLocation) {
            const group = L.featureGroup(markersRef.current);
            map.fitBounds(group.getBounds(), { padding: [50, 50] });
        }
    }, [sortedBills, selectedBillId]);

    const handleCardClick = (bill: Bill & { lat: number, lng: number }) => {
        setSelectedBillId(bill.id);
        setIsFollowing(false); // Stop following user when selecting a bill
        if (leafletMap.current) {
            leafletMap.current.setView([bill.lat, bill.lng], 16, { animate: true });
        }
    };

    const handleRecenter = () => {
        if (userLocation && leafletMap.current) {
            leafletMap.current.setView([userLocation.lat, userLocation.lng], 16, { animate: true });
            setIsFollowing(true);
        } else if (!userLocation) {
            alert("Chưa có vị trí GPS!");
        }
    };

    const handleTotalBlur = (id: string, value: string) => {
        const num = Number(value.replace(/[^0-9]/g, ""));
        if (!isNaN(num)) onUpdateBill(id, { total: num });
    };

    const handleNoteBlur = (id: string, value: string) => {
        onUpdateBill(id, { note: value });
    };

    return (
        <div className="flex flex-col md:flex-row h-[calc(100vh-60px)] overflow-hidden">
            {/* MAP */}
            <div className="w-full md:w-[60%] h-[45%] md:h-full relative z-0 shadow-md order-1 md:order-1">
                <div ref={mapRef} className="w-full h-full bg-gray-200" />

                {/* Legend */}
                <div className="absolute top-2 right-2 bg-white/90 p-2 rounded shadow text-xs z-[400]">
                    <div className="flex items-center gap-2 mb-1"><div className="w-3 h-3 bg-orange-600 rounded-full"></div> Cần thu</div>
                    <div className="flex items-center gap-2 mb-1"><div className="w-3 h-3 bg-purple-600 rounded-full"></div> Có vấn đề</div>
                    <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-600 rounded-full border-2 border-white"></div> Vị trí bạn</div>
                </div>

                {/* Map Type Toggle */}
                <button
                    onClick={() => setMapType(prev => prev === 'street' ? 'satellite' : 'street')}
                    className="absolute top-2 left-2 bg-white text-gray-700 p-2 rounded shadow z-[400] text-xs font-bold flex items-center gap-1 hover:bg-gray-100"
                >
                    {mapType === 'street' ? <Satellite size={16} /> : <MapIcon size={16} />}
                    {mapType === 'street' ? 'Vệ tinh' : 'Bản đồ'}
                </button>

                {/* Re-center Button */}
                <button
                    onClick={handleRecenter}
                    className={`absolute bottom-4 right-4 p-3 rounded-full shadow-lg z-[400] transition-colors ${isFollowing ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:text-blue-600'}`}
                    title="Về vị trí hiện tại"
                >
                    <Navigation size={24} className={isFollowing ? "fill-current" : ""} />
                </button>

                {!userLocation && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/70 text-white px-4 py-2 rounded-full flex items-center gap-2 z-[400]">
                        <Loader2 className="animate-spin w-4 h-4" /> Đang lấy vị trí...
                    </div>
                )}
            </div>

            {/* LIST */}
            <div className="w-full md:w-[40%] h-[55%] md:h-full bg-gray-50 flex flex-col border-l border-gray-200 order-2 md:order-2 shadow-inner relative z-10">
                <div className="p-3 bg-white border-b shadow-sm">
                    <h3 className="font-bold text-gray-700 flex items-center gap-2">
                        <MapPin size={16} className="text-blue-600" />
                        Cần thu gần bạn ({sortedBills.length})
                    </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {sortedBills.length === 0 ? (
                        <div className="text-center p-8 text-gray-400 text-sm">
                            <p className="mb-2">Tuyệt vời! Không còn hóa đơn nào cần thu ở các vị trí đã định vị.</p>
                        </div>
                    ) : (
                        sortedBills.map((bill) => {
                            const isSelected = bill.id === selectedBillId;
                            // Use same styling logic as List view
                            const isPrinted = !!bill.lastPrinted;
                            let rowBgClass = isSelected ? "bg-blue-50 border-blue-400 ring-1 ring-blue-300" : isPrinted ? "bg-blue-50" : bill.total === 0 ? "bg-green-50" : bill.total < 10000 ? "bg-orange-50" : "bg-white";

                            return (
                                <div
                                    key={bill.id}
                                    id={`bill-card-${bill.id}`}
                                    onClick={() => handleCardClick(bill)}
                                    className={`p-3 border-b border-gray-100 flex items-center gap-3 rounded-lg ${rowBgClass} active:bg-gray-100 transition-colors cursor-pointer`}
                                >
                                    {/* Left: Print Button */}
                                    <div className="shrink-0">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onBillClick(bill); }}
                                            className={`w-[45px] h-[45px] rounded-lg flex flex-col items-center justify-center gap-0.5 shadow-sm active:scale-95 transition-all ${isPrinted ? 'bg-white border border-blue-400 text-blue-700' : 'bg-blue-600 text-white'}`}
                                        >
                                            <Printer size={18} />
                                            <span className="text-[9px] font-bold">IN</span>
                                        </button>
                                    </div>

                                    {/* Middle: Info */}
                                    <div className="flex-1 min-w-0 space-y-1">
                                        <div className="flex justify-between items-start">
                                            <div className="font-bold text-blue-900 text-sm break-words pr-1">{bill.customerName}</div>
                                            {/* Distance Badge specific for Map Tab */}
                                            {userLocation && (
                                                <div className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded flex items-center gap-0.5 whitespace-nowrap ml-1 shrink-0">
                                                    <Navigation size={10} /> {bill.distance.toFixed(1)} km
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-xs text-gray-500 line-clamp-2 leading-tight">{bill.address}</div>

                                        {/* Phone & Code */}
                                        <div className="flex flex-wrap items-center gap-3 text-xs">
                                            {bill.phone && (
                                                <a href={`tel:${bill.phone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-gray-500 hover:text-blue-600 font-medium">
                                                    <Phone size={11} className="text-gray-400" /> {bill.phone}
                                                </a>
                                            )}
                                            {(bill.paymentCode || bill.subscriberNumber) && (
                                                <span className="text-[10px] text-gray-400 font-mono">
                                                    #{bill.paymentCode || bill.subscriberNumber}
                                                </span>
                                            )}
                                        </div>

                                        {/* Actions Row (Map, QR, Status, Note) - Standardized Size 16 */}
                                        <div className="flex flex-wrap gap-3 items-center mt-2">
                                            {bill.location && (
                                                <a href={bill.location} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-blue-600 bg-blue-50 p-2 rounded-md hover:bg-blue-100 border border-blue-200 shadow-sm transition-colors" title="Xem bản đồ">
                                                    <MapIcon size={16} />
                                                </a>
                                            )}
                                            {bill.qrLink && (
                                                <button onClick={(e) => { e.stopPropagation(); onPrintQR(bill); }} className="text-green-600 bg-green-50 p-2 rounded-md hover:bg-green-100 border border-green-200 shadow-sm transition-colors" title="In QR">
                                                    <QrCode size={16} />
                                                </button>
                                            )}
                                            {bill.status && (
                                                <span className="inline-flex items-center gap-1.5 bg-purple-50 text-purple-700 px-2 py-1.5 rounded-md font-bold border border-purple-200 text-xs shadow-sm">
                                                    <AlertTriangle size={16} /> {bill.status}
                                                </span>
                                            )}
                                            {bill.note && (
                                                <span className="inline-flex items-center gap-1.5 text-gray-600 bg-gray-50 px-2 py-1.5 rounded-md border border-gray-200 text-xs shadow-sm">
                                                    <StickyNote size={16} /> {bill.note}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Right: Total + Edit */}
                                    <div className="flex flex-col items-end gap-1 shrink-0">
                                        <div className="relative w-[90px]">
                                            <input
                                                type="number"
                                                key={`${bill.id}-total-${bill.total}`}
                                                defaultValue={bill.total}
                                                onBlur={(e) => handleTotalBlur(bill.id, e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-full text-right font-bold text-red-600 outline-none bg-transparent text-sm focus:border-b focus:border-red-400 p-0"
                                            />
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onEditBill(bill); }}
                                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                                        >
                                            <Info size={20} />
                                        </button>
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

const BillModal: React.FC<{
    bill: Bill;
    title: string;
    onClose: () => void;
    onSave: (updatedBill: Bill) => void
}> = ({ bill, title, onClose, onSave }) => {
    const [formData, setFormData] = useState<Bill>({ ...bill });

    const handleChange = (field: keyof Bill, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleStaffChange = (field: 'code' | 'name' | 'phone', value: string) => {
        setFormData(prev => ({
            ...prev,
            staff: { ...prev.staff, [field]: value }
        }));
    };

    const handleSave = () => {
        if (!formData.customerName.trim()) { alert("Vui lòng nhập tên khách hàng"); return; }
        if (!formData.period.trim()) { alert("Vui lòng nhập nội dung thu"); return; }
        onSave(formData);
    };

    const STATUS_OPTIONS = ["Vắng nhà", "TTOL T2", "Hẹn", "Không LH được", "Khiếu nại", "Báo hỏng", "Huỷ", "Zalo"];
    // Tăng size chữ input lên text-base trên mobile để tránh zoom
    const inputClass = "w-full border border-gray-300 rounded p-2 bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none text-base md:text-sm";

    return (
        // Chuyển sang Full Screen Modal trên Mobile (fixed inset-0 bg-white)
        <div className="fixed inset-0 z-[60] flex flex-col md:items-center md:justify-center md:bg-black/60 md:p-4 bg-gray-50">
            <div className="bg-white md:rounded-xl shadow-2xl w-full h-full md:h-auto md:max-h-[90vh] md:max-w-lg flex flex-col">
                <div className="p-4 border-b flex justify-between items-center bg-blue-700 text-white md:rounded-t-xl shrink-0">
                    <button onClick={onClose} className="md:hidden mr-2"><ChevronLeft size={24} /></button>
                    <h3 className="font-bold text-lg flex items-center gap-2 mr-auto">
                        {title === "Tạo Hóa Đơn Mới" ? <Plus size={20} /> : <Info size={20} />} {title}
                    </h3>
                    <button onClick={onClose} className="hidden md:block"><X size={24} /></button>
                </div>

                <div className="p-4 overflow-y-auto flex-1 space-y-4 bg-gray-50">
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                        <label className="block text-xs font-bold text-gray-600 mb-2 flex items-center gap-1">
                            <AlertTriangle size={14} className="text-orange-500" />
                            TRẠNG THÁI KHÁCH HÀNG
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {STATUS_OPTIONS.map(st => (
                                <button key={st} onClick={() => handleChange('status', st === formData.status ? '' : st)}
                                    className={`px-3 py-2 rounded text-xs font-bold border transition-all ${formData.status === st ? 'bg-orange-100 text-orange-700 border-orange-300 ring-1 ring-orange-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                                    {st}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 mb-2">
                        <label className="block text-xs font-bold text-blue-700 mb-1 uppercase">Nội dung thu</label>
                        <input type="text" className={`${inputClass} border-blue-300 font-bold text-blue-800`} placeholder="Nhập nội dung cần thu..." value={formData.period} onChange={e => handleChange('period', e.target.value)} />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="block text-xs font-bold text-gray-600 mb-1">Tên Khách Hàng *</label><input type="text" className={`${inputClass} font-bold`} value={formData.customerName} onChange={e => handleChange('customerName', e.target.value)} /></div>
                        <div><label className="block text-xs font-bold text-gray-600 mb-1">Mã KH / Mã TT</label><input type="text" className={inputClass} value={formData.paymentCode} onChange={e => handleChange('paymentCode', e.target.value)} /></div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="block text-xs font-bold text-gray-600 mb-1">Số Thuê Bao</label><input type="text" className={inputClass} value={formData.subscriberNumber} onChange={e => handleChange('subscriberNumber', e.target.value)} /></div>
                        <div><label className="block text-xs font-bold text-gray-600 mb-1">Số Điện Thoại</label><input type="text" className={inputClass} value={formData.phone} onChange={e => handleChange('phone', e.target.value)} /></div>
                    </div>

                    <div><label className="block text-xs font-bold text-gray-600 mb-1">Địa chỉ</label><textarea rows={1} className={inputClass} value={formData.address} onChange={e => handleChange('address', e.target.value)} /></div>

                    <div className="grid grid-cols-1 gap-2 bg-gray-100 p-2 rounded border border-gray-200">
                        <div><label className="block text-xs font-bold text-gray-600 mb-1 flex items-center gap-1"><MapPin size={14} /> Vị trí Google Maps</label><input type="text" className={`${inputClass} text-blue-600`} placeholder="Dán link maps tại đây..." value={formData.location || ''} onChange={e => handleChange('location', e.target.value)} /></div>
                    </div>

                    <hr className="border-dashed border-gray-300" />

                    <div className="grid grid-cols-3 gap-2 bg-white p-3 rounded border shadow-sm">
                        <div><label className="block text-xs font-bold text-gray-600 mb-1">Nợ cũ</label><input type="number" className="w-full border rounded p-1.5 text-right outline-none bg-white text-gray-900 text-base md:text-sm" value={formData.oldDebt} onChange={e => handleChange('oldDebt', Number(e.target.value))} /></div>
                        <div><label className="block text-xs font-bold text-gray-600 mb-1">Phát sinh</label><input type="number" className="w-full border rounded p-1.5 text-right outline-none bg-white text-gray-900 text-base md:text-sm" value={formData.incurredFee} onChange={e => handleChange('incurredFee', Number(e.target.value))} /></div>
                        <div><label className="block text-xs font-bold text-red-600 mb-1">TỔNG THU *</label><input type="number" className="w-full border border-red-300 rounded p-1.5 text-right font-bold text-red-600 outline-none bg-white text-base md:text-sm" value={formData.total} onChange={e => handleChange('total', Number(e.target.value))} /></div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="block text-xs font-bold text-gray-600 mb-1">Mã Nhân Viên</label><input type="text" className={inputClass} value={formData.staff.code} onChange={handleStaffChange.bind(null, 'code')} /></div>
                        <div><label className="block text-xs font-bold text-gray-600 mb-1">Ghi chú thêm</label><textarea rows={1} className={inputClass} value={formData.note} onChange={e => handleChange('note', e.target.value)} /></div>
                    </div>
                </div>

                <div className="p-4 border-t bg-white flex gap-3 shrink-0 md:rounded-b-xl pb-6 md:pb-4">
                    <button onClick={onClose} className="flex-1 py-3 rounded-lg border border-gray-300 font-bold text-gray-600 hover:bg-gray-100 bg-white">Hủy</button>
                    <button onClick={handleSave} className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-md flex items-center justify-center gap-2"><Save size={18} /> {title === "Tạo Hóa Đơn Mới" ? "Tạo & Lưu" : "Lưu"}</button>
                </div>
            </div>
        </div>
    );
};

const SettingsModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    config: SheetConfig;
    onSave: (config: SheetConfig) => void;
}> = ({ isOpen, onClose, config, onSave }) => {
    const [url, setUrl] = useState(config.url);
    const [enabled, setEnabled] = useState(config.enabled);

    if (!isOpen) return null;

    const handleSave = () => { onSave({ url, enabled }); onClose(); };

    return (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
                <div className="p-4 border-b bg-gray-100 rounded-t-xl flex justify-between items-center"><h3 className="font-bold flex items-center gap-2"><Settings size={20} /> Cấu hình Google Sheet</h3><button onClick={onClose}><X size={20} /></button></div>
                <div className="p-4 space-y-4">
                    <div className="flex items-center justify-between bg-blue-50 p-3 rounded border border-blue-100">
                        <span className="text-sm font-bold text-blue-900">Sử dụng Google Sheet làm Database</span>
                        <label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="sr-only peer" /><div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div></label>
                    </div>
                    <div className={`space-y-2 transition-opacity ${enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                        <label className="block text-sm font-bold text-gray-700">Link Web App</label>
                        <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/..." className="w-full border rounded p-2 text-base md:text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                </div>
                <div className="p-4 border-t flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">Hủy</button>
                    <button onClick={handleSave} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-bold">Lưu</button>
                </div>
            </div>
        </div>
    );
}

// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
    const [bills, setBills] = useState<Bill[]>([]);
    const [filterName, setFilterName] = useState('');
    const deferredFilterName = useDeferredValue(filterName);
    const [sortPrintedBottom, setSortPrintedBottom] = useState<boolean>(true);
    const [sortStatusBottom, setSortStatusBottom] = useState<boolean>(false); // New State for Status Sort
    const [loading, setLoading] = useState<boolean>(true);
    const [isDataLoaded, setIsDataLoaded] = useState(false);
    const [activeTab, setActiveTab] = useState<'list' | 'report' | 'map'>('list');
    const [activeRowId, setActiveRowId] = useState<string | null>(null);
    const [showHeader, setShowHeader] = useState(true);
    const lastScrollY = useRef(0);
    const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
    const [showPrintModal, setShowPrintModal] = useState(false);
    const [editingBill, setEditingBill] = useState<Bill | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);
    const [btDeviceName, setBtDeviceName] = useState<string | null>(null);
    const [btError, setBtError] = useState<string | null>(null);
    const [isBtSupported, setIsBtSupported] = useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [sheetConfig, setSheetConfig] = useState<SheetConfig>({ url: '', enabled: false });
    const [showSettings, setShowSettings] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [pendingSync, setPendingSync] = useState(0);
    const [visibleCount, setVisibleCount] = useState<number>(30);

    // --- NEW GPS STATE ---
    const [gpsSignal, setGpsSignal] = useState<{ lat: number, lng: number, acc: number, heading: number | null } | null>(null);

    // --- GPS WATCHER (CORE FIX FOR ACCURACY) ---
    useEffect(() => {
        if (!navigator.geolocation) return;

        const options = {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        };

        const handleSuccess = (pos: GeolocationPosition) => {
            setGpsSignal({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                acc: pos.coords.accuracy,
                heading: pos.coords.heading
            });
        };

        const handleError = (err: GeolocationPositionError) => {
            console.warn("GPS Error:", err);
        };

        // 1. Watch position (Standard way)
        const watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, options);

        // 2. Fallback polling for iOS (forces GPS hardware to stay active and update frequently)
        let timeoutId: NodeJS.Timeout;
        const pollGPS = () => {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    handleSuccess(pos);
                    timeoutId = setTimeout(pollGPS, 3000);
                },
                (err) => {
                    // Ignore timeout errors from polling to avoid console spam, just retry
                    if (err.code !== err.TIMEOUT) {
                        handleError(err);
                    }
                    timeoutId = setTimeout(pollGPS, 3000);
                },
                options
            );
        };
        pollGPS();

        return () => {
            navigator.geolocation.clearWatch(watchId);
            clearTimeout(timeoutId);
        };
    }, []);

    const preparedBills = useMemo(() => {
        return bills.map(bill => {
            const searchStr = removeAccents(
                `${bill.customerName} ${bill.subscriberNumber} ${bill.paymentCode} ${bill.phone} ${bill.address} ${bill.note} ${bill.period} ${bill.staff?.code} ${bill.status} ${bill.total} `
            );
            return { ...bill, searchStr };
        });
    }, [bills]);

    const filteredBills = useMemo(() => {
        let result = preparedBills;
        if (deferredFilterName.trim()) {
            const searchKey = removeAccents(deferredFilterName.trim());
            result = result.filter(b => b.searchStr.includes(searchKey));
        }

        // Logic sắp xếp: 
        // 1. In/0đ (Nếu bật) -> Đẩy xuống đáy
        // 2. Status khác rỗng (Nếu bật) -> Đẩy xuống đáy (nhưng trên bọn In/0đ nếu cả 2 cùng bật)
        // Sửa logic để dễ hiểu: Gán điểm. Điểm càng cao càng nằm dưới.

        if (sortPrintedBottom || sortStatusBottom) {
            result = [...result].sort((a, b) => {
                let scoreA = 0;
                let scoreB = 0;

                const isAPrinted = (a.total === 0) || (!!a.lastPrinted);
                const isBPrinted = (b.total === 0) || (!!b.lastPrinted);
                const isAStatus = !!a.status;
                const isBStatus = !!b.status;

                if (sortPrintedBottom) {
                    if (isAPrinted) scoreA += 20;
                    if (isBPrinted) scoreB += 20;
                }

                if (sortStatusBottom) {
                    if (isAStatus) scoreA += 10;
                    if (isBStatus) scoreB += 10;
                }

                return scoreA - scoreB;
            });
        }

        return result;
    }, [deferredFilterName, preparedBills, sortPrintedBottom, sortStatusBottom]);

    useEffect(() => { setVisibleCount(30); }, [deferredFilterName, sortPrintedBottom, sortStatusBottom]);

    useEffect(() => {
        const handleScroll = () => {
            if (activeTab !== 'list') return;
            const isNearBottom = (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500;
            if (isNearBottom) {
                setVisibleCount(prev => (prev >= filteredBills.length ? prev : prev + 30));
            }
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, [activeTab, filteredBills.length]);

    useEffect(() => {
        const init = async () => {
            setLoading(true);
            const config = getSheetConfig();
            setSheetConfig(config);
            setPendingSync(getSyncQueue().length);
            let data: Bill[] = [];
            if (config.enabled && config.url) {
                try {
                    const rawData = await fetchBillsFromAPI(config.url);
                    data = sanitizeBills(rawData);
                } catch (e) { data = await getBills(); }
            } else {
                data = await getBills();
            }
            setBills(data);
            setLoading(false);
            setIsDataLoaded(true);
        };
        init();
        if (!('bluetooth' in navigator)) setIsBtSupported(false);
    }, []);

    useEffect(() => { if (isDataLoaded) saveBills(bills); }, [bills, isDataLoaded]);

    useEffect(() => {
        const handleOnline = () => { if (sheetConfig.enabled && sheetConfig.url) processQueue(); };
        const processQueue = async () => {
            if (!navigator.onLine || !sheetConfig.enabled || !sheetConfig.url) return;
            setIsSyncing(true);
            try {
                await processSyncQueue(sheetConfig.url);
                setPendingSync(getSyncQueue().length);
            } catch (e) { console.error("Auto sync push failed", e); } finally { setIsSyncing(false); }
        };
        window.addEventListener('online', handleOnline);
        const pushInterval = setInterval(processQueue, 30000);
        const pollInterval = setInterval(async () => {
            if (!navigator.onLine || !sheetConfig.enabled || !sheetConfig.url) return;
            if (getSyncQueue().length > 0 || isCreating || editingBill || isPrinting || document.hidden) return;
            try {
                const rawData = await fetchBillsFromAPI(sheetConfig.url);
                const validData = sanitizeBills(rawData);
                setBills(prev => (JSON.stringify(prev) === JSON.stringify(validData) ? prev : validData));
            } catch (e) { console.warn("Silent pull failed", e); }
        }, 10000);
        return () => { window.removeEventListener('online', handleOnline); clearInterval(pushInterval); clearInterval(pollInterval); };
    }, [sheetConfig, isCreating, editingBill, isPrinting]);

    const handleRefresh = async () => {
        if (!sheetConfig.enabled || !sheetConfig.url) return;
        setIsSyncing(true);
        try {
            await processSyncQueue(sheetConfig.url);
            setPendingSync(getSyncQueue().length);
            const rawData = await fetchBillsFromAPI(sheetConfig.url);
            const validData = sanitizeBills(rawData);
            setBills(validData);
            alert(`Đã đồng bộ ${validData.length} hóa đơn từ Sheet.`);
        } catch (e) { alert("Lỗi đồng bộ: " + e); } finally { setIsSyncing(false); }
    };

    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;
            if (currentScrollY > lastScrollY.current && currentScrollY > 50) setShowHeader(false);
            else setShowHeader(true);
            lastScrollY.current = currentScrollY;
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const handleCreateNewBill = () => setIsCreating(true);

    const handleSaveNewBill = async (newBill: Bill) => {
        setBills(prev => [newBill, ...prev]);
        setIsCreating(false);
        setActiveRowId(newBill.id);
        if (sheetConfig.enabled && sheetConfig.url) {
            setIsSyncing(true);
            try { await addBillAPI(sheetConfig.url, newBill); }
            catch (e) { addToSyncQueue('ADD', newBill); setPendingSync(getSyncQueue().length); }
            finally { setIsSyncing(false); }
        }
    };

    const emptyBillTemplate = (): Bill => ({
        id: `manual_${Date.now()}`,
        customerName: '', subscriberNumber: '', paymentCode: '', phone: '', address: '', location: '', qrLink: '',
        period: `Cước tháng ${new Date().getMonth() + 1}/${new Date().getFullYear()}`,
        oldDebt: 0, incurredFee: 0, total: 0, staff: bills.length > 0 ? { ...bills[0].staff } : { code: '', name: '', phone: '' },
        note: '', lastPrinted: '', status: ''
    });

    const processRawDataToBills = (rows: any[][]): Bill[] => {
        if (!rows || rows.length === 0) return [];
        const newBills: Bill[] = [];
        let headerRowIndex = -1;
        for (let i = 0; i < Math.min(rows.length, 5); i++) {
            const rowStr = (JSON.stringify(rows[i]) || "").toLowerCase();
            if (rowStr.includes('tên') || rowStr.includes('name') || rowStr.includes('khách hàng') || rowStr.includes('stt')) { headerRowIndex = i; break; }
        }
        let map = { id: 0, name: 1, sub: 2, payCode: 3, phone: 4, addr: 5, period: 6, debt: 7, fee: 8, total: 9, staff: 10, note: 11, location: -1, qrLink: -1, status: -1 };
        if (headerRowIndex !== -1) {
            map = { id: -1, name: -1, sub: -1, payCode: -1, phone: -1, addr: -1, period: -1, debt: -1, fee: -1, total: -1, staff: -1, note: -1, location: -1, qrLink: -1, status: -1 };
            const headers = Array.from(rows[headerRowIndex] || []).map(h => String(h || "").toLowerCase().trim());
            const findIdx = (keywords: string[]) => headers.findIndex(h => h && keywords.some(k => h.includes(k)));
            map.name = findIdx(['tên', 'name']); map.addr = findIdx(['địa chỉ', 'address']); map.total = findIdx(['tổng', 'total']);
            map.period = findIdx(['kỳ', 'tháng', 'content']); map.sub = findIdx(['thuê bao', 'sub']); map.payCode = findIdx(['mã tt', 'payment', 'code']);
            map.id = findIdx(['id', 'stt']); map.debt = findIdx(['nợ', 'debt']); map.fee = findIdx(['phát sinh', 'fee']);
            map.phone = findIdx(['sđt', 'phone']); map.staff = findIdx(['nhân viên', 'staff']); map.note = findIdx(['ghi chú', 'note']);
            map.location = findIdx(['vị trí', 'location', 'map']); map.qrLink = findIdx(['qr', 'link']); map.status = findIdx(['trạng thái', 'status']);
            if (map.name === -1 && rows[headerRowIndex].length > 1) map.name = 1;
            if (map.total === -1 && rows[headerRowIndex].length > 9) map.total = 9;
        }
        const startIndex = headerRowIndex === -1 ? 0 : headerRowIndex + 1;
        for (let i = startIndex; i < rows.length; i++) {
            const row = rows[i]; if (!row || row.length < 2) continue;
            const val = (idx: number) => (idx !== -1 && idx !== undefined && row[idx] !== undefined && row[idx] !== null) ? String(row[idx]).trim() : '';
            const money = (idx: number) => {
                const v = val(idx); if (!v || v === '#N/A') return 0;
                let cleanV = v; if (cleanV.includes(',') && !cleanV.includes('.')) cleanV = cleanV.replace(/,/g, '.');
                let num = Number(cleanV.replace(/[^0-9.-]+/g, "")) || 0;
                return (num > 0 && num < 10000) ? num * 1000 : num;
            };
            if (!val(map.name)) continue;
            let statusLower = val(map.status).toLowerCase();
            let importedLastPrinted = (statusLower.includes('đã in') || statusLower.includes('đã thu')) ? (val(map.status).length > 5 ? val(map.status) : `${new Date().getDate()}/${new Date().getMonth() + 1}`) : '';
            let finalId = val(map.id) || `${Date.now()}_${i}_${Math.random().toString(36).substr(2, 6)}`;
            newBills.push({
                id: finalId, customerName: val(map.name), subscriberNumber: val(map.sub), paymentCode: val(map.payCode), phone: val(map.phone),
                address: val(map.addr), location: val(map.location), qrLink: val(map.qrLink), period: val(map.period) || `Tháng ${new Date().getMonth() + 1}`,
                oldDebt: money(map.debt), incurredFee: money(map.fee), total: money(map.total), staff: { code: val(map.staff), name: '', phone: '' },
                note: val(map.note), lastPrinted: importedLastPrinted, status: (!importedLastPrinted && val(map.status)) ? val(map.status) : ''
            });
        }
        return newBills;
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target?.result;
                const workbook = XLSX.read(bstr, { type: 'binary' });
                const ws = workbook.Sheets[workbook.SheetNames[0]];
                const newBills = processRawDataToBills(XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][]);
                setBills(newBills);
                if (fileInputRef.current) fileInputRef.current.value = '';
                alert(`Đã nhập thành công ${newBills.length} hóa đơn!`);
            } catch (error) { alert("Lỗi đọc file Excel."); }
        };
        reader.readAsBinaryString(file);
    };

    const handlePasteData = async () => {
        try {
            const text = await navigator.clipboard.readText(); if (!text) { alert("Clipboard trống!"); return; }
            const newBills = processRawDataToBills(text.trim().split('\n').map(row => row.split('\t')));
            if (newBills.length > 0 && window.confirm(`Tìm thấy ${newBills.length} dòng. Thay thế dữ liệu hiện tại?`)) setBills(newBills);
            else alert("Không tìm thấy dữ liệu hợp lệ.");
        } catch (err) { alert("Lỗi đọc Clipboard."); }
    };

    const handleDeleteAll = () => {
        if (window.confirm("BẠN CÓ CHẮC CHẮN MUỐN XÓA TOÀN BỘ DỮ LIỆU?")) { setBills([]); saveBills([]); if (fileInputRef.current) fileInputRef.current.value = ''; }
    };

    const handlePrintClick = (bill: Bill, e: React.MouseEvent) => { e.stopPropagation(); setSelectedBill(bill); setShowPrintModal(true); setBtError(null); };
    const handleMapBillClick = (bill: Bill) => { setSelectedBill(bill); setShowPrintModal(true); setBtError(null); };
    const handleMapEditClick = (bill: Bill) => { setEditingBill(bill); };
    const handleEditClick = (bill: Bill, e: React.MouseEvent) => { e.stopPropagation(); setEditingBill(bill); };

    const handleSaveEditedBill = async (updatedBill: Bill) => {
        setBills(prev => prev.map(b => b.id === updatedBill.id ? updatedBill : b));
        setEditingBill(null);
        if (sheetConfig.enabled && sheetConfig.url) {
            setIsSyncing(true);
            try { const res = await updateBillAPI(sheetConfig.url, updatedBill); if (res.status === 'error') throw new Error(res.message); }
            catch (e) { addToSyncQueue('UPDATE', updatedBill); setPendingSync(getSyncQueue().length); }
            finally { setIsSyncing(false); }
        }
    };

    const handleConnectBluetooth = async () => {
        setBtError(null);
        try { const deviceName = await connectPrinter(); setBtDeviceName(deviceName); }
        catch (err: any) { setBtError(err.message); }
    };

    const updateBillDataLocally = async (id: string, updates: Partial<Bill>) => {
        setBills(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
        if (sheetConfig.enabled && sheetConfig.url) {
            try { await updateBillAPI(sheetConfig.url, { id, ...updates }); }
            catch (e) { addToSyncQueue('UPDATE', { id, ...updates }); setPendingSync(getSyncQueue().length); }
        }
    };

    const handleNoteBlur = (id: string, newNote: string) => {
        const currentBill = bills.find(b => b.id === id);
        if (currentBill && currentBill.note !== newNote) updateBillDataLocally(id, { note: newNote });
    };

    const handleTotalBlur = (id: string, value: string) => {
        const num = Number(value.replace(/[^0-9]/g, ""));
        if (!isNaN(num)) updateBillDataLocally(id, { total: num });
    };

    // --- NEW OPTIMISTIC PRINT LOGIC ---
    const handleDirectBluetoothPrint = async () => {
        if (!selectedBill) return;
        setBtError(null);

        // 1. Optimistic Update (Instant UI feedback)
        const now = new Date();
        const timeStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        // Update local state immediately so user sees "Printed" status
        updateBillDataLocally(selectedBill.id, { lastPrinted: timeStr });
        setSelectedBill(prev => prev ? { ...prev, lastPrinted: timeStr } : null);

        // 2. Process Printing in "Background"
        // We don't await this to block the UI, but we track 'isPrinting' for the specific modal
        setIsPrinting(true);
        try {
            await printBillBluetooth(selectedBill);
        } catch (err: any) {
            setBtError("Lỗi in: " + (err.message || "Mất kết nối"));
            // If print fails, user can try again. We already updated the status, 
            // which is acceptable as they intended to print.
            if (err.message && err.message.includes("GATT")) {
                setBtDeviceName(null);
                disconnectPrinter();
            }
        }
        finally { setIsPrinting(false); }
    };

    const handleActionPrintQR = async (bill: Bill) => {
        if (!btDeviceName) { alert("Vui lòng kết nối máy in trước!"); return; }
        setIsPrinting(true);
        try { await printPaymentQR(bill); }
        catch (err: any) { setBtError("Lỗi in: " + err.message); }
        finally { setIsPrinting(false); }
    };

    // --- PRINT FAULT REPORT (NEW) ---
    const handleActionPrintFault = async (bill: Bill) => {
        if (!btDeviceName) { alert("Vui lòng kết nối máy in trước!"); return; }
        setIsPrinting(true);
        try { await printFaultReport(bill); }
        catch (err: any) { setBtError("Lỗi in: " + err.message); }
        finally { setIsPrinting(false); }
    };

    // --- NEW INSTANT PIN LOGIC ---
    const getHighAccuracyLocation = async (): Promise<{ lat: number, lng: number, acc: number } | null> => {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                resolve(gpsSignal);
                return;
            }

            let bestPos = gpsSignal;

            // If we already have a very good signal, just use it
            if (bestPos && bestPos.acc <= 15) {
                resolve(bestPos);
                return;
            }

            const options = {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 5000
            };

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const newPos = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        acc: pos.coords.accuracy
                    };
                    if (!bestPos || newPos.acc < bestPos.acc) {
                        bestPos = newPos;
                        setGpsSignal(prev => ({ ...prev, ...newPos, heading: pos.coords.heading }));
                    }
                    resolve(bestPos);
                },
                (err) => {
                    console.warn("Manual GPS fetch error:", err);
                    resolve(bestPos); // fallback to cached
                },
                options
            );
        });
    };

    const handlePinLocationOnly = async () => {
        if (!selectedBill) return;
        if (selectedBill.location && !window.confirm("Hoá đơn này đã có vị trí. Ghi đè?")) return;

        const loc = await getHighAccuracyLocation();

        if (loc) {
            if (loc.acc > 30) {
                if (!window.confirm(`Độ chính xác hiện tại là ${Math.round(loc.acc)}m (hơi thấp). Bạn có chắc chắn muốn ghim?`)) {
                    return;
                }
            }
            const mapLink = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
            await updateBillDataLocally(selectedBill.id, { location: mapLink });
            setSelectedBill(prev => prev ? { ...prev, location: mapLink } : null);
            alert(`Đã ghim vị trí! (Độ chính xác: ${Math.round(loc.acc)}m)`);
        } else {
            alert("Đang tìm tín hiệu GPS... Vui lòng chờ 1 lát rồi thử lại.");
        }
    };

    const handlePrintThenPin = async () => {
        if (!selectedBill || !btDeviceName) return;

        // 1. Optimistic Update (Mark as printed immediately)
        const now = new Date();
        const timeStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        // Prepare updates
        const updates: Partial<Bill> = { lastPrinted: timeStr };

        // 2. Grab GPS
        const loc = await getHighAccuracyLocation();
        if (loc && (!selectedBill.location || window.confirm("Cập nhật vị trí mới?"))) {
            if (loc.acc <= 30 || window.confirm(`Độ chính xác hiện tại là ${Math.round(loc.acc)}m. Vẫn ghim?`)) {
                updates.location = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
            }
        }

        // 3. Apply updates to UI & Server
        updateBillDataLocally(selectedBill.id, updates);
        setSelectedBill(prev => prev ? { ...prev, ...updates } : null);

        // 4. Print in background (Non-blocking)
        setIsPrinting(true);
        setBtError(null);

        printBillBluetooth(selectedBill).catch(err => {
            setBtError("Lỗi in: " + err.message);
            if (err.message && err.message.includes("GATT")) {
                setBtDeviceName(null);
                disconnectPrinter();
            }
        }).finally(() => {
            setIsPrinting(false);
        });
    };

    const closePrintModal = () => { setShowPrintModal(false); setSelectedBill(null); setBtError(null); };
    const formatMoney = (val: number) => val.toLocaleString('vi-VN');

    // Compact GPS Signal Icon
    const GpsIndicatorCompact = () => {
        if (!gpsSignal) return <Satellite className="w-4 h-4 text-gray-400 animate-pulse" />;
        const acc = gpsSignal.acc;
        let colorClass = "bg-green-500";
        if (acc > 50) colorClass = "bg-red-500";
        else if (acc > 10) colorClass = "bg-yellow-500";

        return (
            <div className="flex items-center gap-1" title={`GPS: ${Math.round(acc)}m`}>
                <div className={`w-3 h-3 rounded-full ${colorClass} animate-pulse shadow-sm border border-white`}></div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-gray-50 text-base flex flex-col">
            <input type="file" accept=".xlsx, .xls" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
            <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} config={sheetConfig} onSave={(newConfig) => { setSheetConfig(newConfig); saveSheetConfig(newConfig); if (newConfig.enabled && newConfig.url !== sheetConfig.url) window.location.reload(); }} />

            <div className={`sticky top-0 z-50 shadow-md bg-white transition-transform duration-300 ease-in-out ${showHeader ? 'translate-y-0' : '-translate-y-full'}`}>
                <header className="bg-blue-700 text-white p-2 md:p-3">
                    <div className="max-w-7xl mx-auto flex items-center justify-between">
                        <div className="flex items-center gap-1 md:gap-2">
                            <FileText className="w-5 h-5 md:w-6 md:h-6" />
                            <h1 className="text-base md:text-xl font-bold tracking-tight truncate max-w-[120px] md:max-w-none">ngotanthong - VNPT Bill</h1>
                            <div className="flex items-center gap-2">
                                {pendingSync > 0 && <div className="hidden md:flex items-center gap-1 bg-yellow-500 text-white text-[10px] px-2 py-0.5 rounded-full border border-yellow-400 font-bold animate-pulse"><CloudOff className="w-3 h-3" /><span>{pendingSync} chờ sync</span></div>}
                                {sheetConfig.enabled ? (
                                    <div className={`hidden md:flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${isSyncing ? 'bg-green-600 border-green-400' : pendingSync > 0 ? 'bg-yellow-500/20 text-yellow-100 border-yellow-500/50' : 'bg-green-500/20 text-green-100 border-green-500/30'}`}>
                                        {isSyncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : pendingSync > 0 ? <WifiOff className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
                                        <span>{isSyncing ? 'SYNC' : 'ONLINE'}</span>
                                    </div>
                                ) : (<div className="hidden md:flex items-center gap-1 bg-gray-500/20 text-gray-200 text-[10px] px-2 py-0.5 rounded-full border border-gray-500/30"><CloudOff className="w-3 h-3" /><span>OFFLINE</span></div>)}
                            </div>
                        </div>

                        {/* GPS INDICATOR IN HEADER (Desktop Only) */}
                        <div className="hidden md:block flex items-center text-xs gap-1">
                            <span className="opacity-70">Độ chính xác:</span> <GpsIndicatorCompact />
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="flex bg-blue-800 rounded p-0.5 mr-2">
                                <button onClick={() => setActiveTab('list')} className={`flex items-center gap-1 px-2 py-1.5 md:px-3 md:py-1.5 rounded text-xs font-bold uppercase transition-colors ${activeTab === 'list' ? 'bg-white text-blue-800 shadow-sm' : 'text-blue-200 hover:text-white'}`}><List size={16} /> <span className="hidden sm:inline">DS</span></button>
                                <button onClick={() => setActiveTab('map')} className={`flex items-center gap-1 px-2 py-1.5 md:px-3 md:py-1.5 rounded text-xs font-bold uppercase transition-colors ${activeTab === 'map' ? 'bg-white text-blue-800 shadow-sm' : 'text-blue-200 hover:text-white'}`}><MapIcon size={16} /> <span className="hidden sm:inline">Bản đồ</span></button>
                                <button onClick={() => setActiveTab('report')} className={`flex items-center gap-1 px-2 py-1.5 md:px-3 md:py-1.5 rounded text-xs font-bold uppercase transition-colors ${activeTab === 'report' ? 'bg-white text-blue-800 shadow-sm' : 'text-blue-200 hover:text-white'}`}><LayoutDashboard size={16} /> <span className="hidden sm:inline">Thống kê</span></button>
                            </div>
                            {activeTab === 'list' && (
                                <div className="flex items-center gap-1">
                                    <button onClick={() => setShowSettings(true)} className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded shadow-sm" title="Cấu hình"><Settings className="w-4 h-4" /></button>
                                    {sheetConfig.enabled ? (
                                        <div className="relative"><button onClick={handleRefresh} className="bg-green-600 hover:bg-green-500 text-white p-2 rounded shadow-sm"><RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} /></button>{pendingSync > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] w-4 h-4 flex items-center justify-center rounded-full border border-white font-bold">{pendingSync}</span>}</div>
                                    ) : (<><button onClick={handlePasteData} className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded shadow-sm"><ClipboardPaste className="w-4 h-4" /></button><button onClick={() => fileInputRef.current?.click()} className="bg-green-600 hover:bg-green-700 text-white p-2 rounded shadow-sm"><Upload className="w-4 h-4" /></button></>)}
                                    <button onClick={handleCreateNewBill} className="bg-white text-blue-700 px-2 py-1.5 md:px-3 rounded shadow-md flex items-center gap-1 active:scale-95"><Plus className="w-4 h-4" /><span className="hidden sm:inline font-bold text-xs uppercase">Tạo</span></button>
                                    {!sheetConfig.enabled && bills.length > 0 && <button onClick={handleDeleteAll} className="hidden md:flex bg-red-600 hover:bg-red-500 text-white p-2 rounded shadow-sm"><Trash2 className="w-4 h-4" /></button>}
                                </div>
                            )}
                        </div>
                    </div>
                </header>
                {pendingSync > 0 && <div className="md:hidden bg-yellow-100 text-yellow-800 text-[10px] py-1 px-3 text-center font-bold border-b border-yellow-200 flex justify-center items-center gap-1"><CloudOff size={10} /> Đang lưu {pendingSync} thay đổi offline.</div>}
                {activeTab === 'list' && (
                    <div className="bg-white p-2 border-b shadow-sm">
                        <div className="max-w-7xl mx-auto flex items-center gap-2">
                            {/* Search Input - Flexible */}
                            <div className="relative flex-1">
                                <input type="text" placeholder="Tìm tên, sđt..." className="w-full border rounded px-2 py-2 pl-8 bg-gray-50 text-base md:text-sm focus:ring-2 focus:ring-blue-500 outline-none h-[40px]" value={filterName} onChange={(e) => setFilterName(e.target.value)} />
                                <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-3" />
                                {filterName && <button onClick={() => setFilterName('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 rounded-full text-gray-400"><X size={16} /></button>}
                            </div>

                            {/* GPS Indicator - Compact */}
                            <div className="md:hidden shrink-0 flex items-center justify-center w-[30px] h-[40px] bg-gray-50 border rounded">
                                <GpsIndicatorCompact />
                            </div>

                            {/* Compact Toggle Buttons */}
                            <div className="flex gap-1 shrink-0">
                                <button
                                    onClick={() => setSortPrintedBottom(!sortPrintedBottom)}
                                    className={`h-[40px] px-3 rounded border flex items-center gap-1 text-xs font-bold transition-all ${sortPrintedBottom ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-gray-50 text-gray-500 border-gray-200'}`}
                                    title="Ẩn/Hiện hoá đơn đã in xuống dưới"
                                >
                                    <EyeOff size={16} /> Ẩn In
                                </button>
                                <button
                                    onClick={() => setSortStatusBottom(!sortStatusBottom)}
                                    className={`h-[40px] px-3 rounded border flex items-center gap-1 text-xs font-bold transition-all ${sortStatusBottom ? 'bg-orange-100 text-orange-700 border-orange-300' : 'bg-gray-50 text-gray-500 border-gray-200'}`}
                                    title="Đẩy hoá đơn có Status xuống dưới"
                                >
                                    <ArrowDownWideNarrow size={16} /> Ẩn Lỗi
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="flex-1 relative">
                {activeTab === 'report' ? <Dashboard bills={bills} /> : activeTab === 'map' ? (
                    <MapTab bills={bills} userLocation={gpsSignal} onBillClick={handleMapBillClick} onEditBill={handleMapEditClick} onUpdateBill={updateBillDataLocally} onPrintQR={handleActionPrintQR} />
                ) : (
                    <main className="max-w-full pb-20 overflow-x-auto">
                        <div className="bg-white border-b border-gray-200">
                            {/* --- MOBILE LIST VIEW (Vertical Layout) --- */}
                            <div className="md:hidden">
                                {loading ? <div className="p-8 text-center text-gray-500">Đang tải...</div> : filteredBills.length === 0 ? (
                                    <div className="p-12 text-center text-gray-500">{bills.length === 0 ? "Chưa có dữ liệu" : "Không tìm thấy kết quả"}</div>
                                ) : (
                                    filteredBills.slice(0, visibleCount).map((bill) => {
                                        const isPrinted = !!bill.lastPrinted;
                                        const isActive = activeRowId === bill.id;
                                        let rowBgClass = isActive ? "bg-yellow-50" : isPrinted ? "bg-blue-50" : bill.total === 0 ? "bg-green-50" : bill.total < 10000 ? "bg-orange-50" : "bg-white";

                                        return (
                                            <div
                                                key={bill.id}
                                                onClick={() => setActiveRowId(bill.id)}
                                                className={`p-3 border-b border-gray-100 flex items-center gap-3 ${rowBgClass} active:bg-gray-100 transition-colors`}
                                            >
                                                {/* Left: Actions (Vertically Centered) */}
                                                <div className="shrink-0">
                                                    <button
                                                        onClick={(e) => handlePrintClick(bill, e)}
                                                        className={`w-[45px] h-[45px] rounded-lg flex flex-col items-center justify-center gap-0.5 shadow-sm active:scale-95 transition-all ${isPrinted ? 'bg-white border border-blue-400 text-blue-700' : 'bg-blue-600 text-white'}`}
                                                    >
                                                        <Printer size={18} />
                                                        <span className="text-[9px] font-bold">IN</span>
                                                    </button>
                                                </div>

                                                {/* Middle: Info */}
                                                <div className="flex-1 min-w-0 space-y-1">
                                                    <div className="font-bold text-blue-900 text-sm truncate pr-1">{bill.customerName}</div>
                                                    <div className="text-xs text-gray-500 line-clamp-2 leading-tight">{bill.address}</div>

                                                    {/* PHONE & CODE (Gray style) */}
                                                    <div className="flex flex-wrap items-center gap-3 text-xs">
                                                        {bill.phone && (
                                                            <a href={`tel:${bill.phone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-gray-500 hover:text-blue-600 font-medium">
                                                                <Phone size={11} className="text-gray-400" /> {bill.phone}
                                                            </a>
                                                        )}
                                                        {(bill.paymentCode || bill.subscriberNumber) && (
                                                            <span className="text-[10px] text-gray-400 font-mono">
                                                                #{bill.paymentCode || bill.subscriberNumber}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* LINKS & STATUS (Restored Map/QR) */}
                                                    <div className="flex flex-wrap gap-3 items-center mt-2">
                                                        {bill.location && (
                                                            <a href={bill.location} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-blue-600 bg-blue-50 p-2 rounded-md hover:bg-blue-100 border border-blue-200 shadow-sm transition-colors" title="Xem bản đồ">
                                                                <MapIcon size={16} />
                                                            </a>
                                                        )}
                                                        {bill.qrLink && (
                                                            <a href={bill.qrLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-green-600 bg-green-50 p-2 rounded-md hover:bg-green-100 border border-green-200 shadow-sm transition-colors" title="Link QR">
                                                                <QrCode size={16} />
                                                            </a>
                                                        )}
                                                        {bill.status && (
                                                            <span className="inline-flex items-center gap-1.5 bg-purple-50 text-purple-700 px-2 py-1.5 rounded-md font-bold border border-purple-200 text-xs shadow-sm">
                                                                <AlertTriangle size={16} /> {bill.status}
                                                            </span>
                                                        )}
                                                        {bill.note && (
                                                            <span className="inline-flex items-center gap-1.5 text-gray-600 bg-gray-50 px-2 py-1.5 rounded-md border border-gray-200 text-xs shadow-sm">
                                                                <StickyNote size={16} /> {bill.note}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Right: Money & Edit */}
                                                <div className="flex flex-col items-end gap-1 shrink-0">
                                                    <div className="relative w-[90px]">
                                                        <input
                                                            type="number"
                                                            key={`${bill.id}-total-${bill.total}`}
                                                            defaultValue={bill.total}
                                                            onBlur={(e) => handleTotalBlur(bill.id, e.target.value)}
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="w-full text-right font-bold text-red-600 outline-none bg-transparent text-sm focus:border-b focus:border-red-400 p-0"
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={(e) => handleEditClick(bill, e)}
                                                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                                                    >
                                                        <Info size={20} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                {filteredBills.length > visibleCount && <div className="p-4 text-center text-xs text-gray-400 bg-gray-50 italic">Đang hiển thị {visibleCount} / {filteredBills.length} kết quả.</div>}
                            </div>

                            {/* --- DESKTOP TABLE VIEW (Original) --- */}
                            <div className="hidden md:block">
                                <table className="w-full text-left border-collapse whitespace-nowrap">
                                    <thead className="bg-gray-100 text-gray-600 uppercase text-[10px] md:text-sm font-bold sticky top-0 z-50">
                                        <tr>
                                            <th className="p-2 border-b sticky left-0 z-50 w-[45px] bg-gray-100 text-center shadow-[1px_0_0_rgba(0,0,0,0.05)] border-r">In</th>
                                            {/* Frozen Customer Name Column */}
                                            <th className="p-2 border-b sticky left-[45px] z-50 bg-gray-100 min-w-[130px] md:w-[150px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r">Tên KH</th>
                                            <th className="p-2 border-b min-w-[180px]">Địa chỉ</th>
                                            <th className="p-2 border-b min-w-[80px] text-right text-red-600">Tổng tiền</th>
                                            <th className="hidden md:table-cell p-2 border-b text-gray-500">Mã TT</th>
                                            <th className="hidden md:table-cell p-2 border-b text-gray-500">SĐT</th>
                                            <th className="hidden md:table-cell p-2 border-b min-w-[140px]">Ghi chú</th>
                                            <th className="p-2 border-b text-center w-[40px]">CT</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 text-xs md:text-sm">
                                        {loading ? <tr><td colSpan={10} className="p-4 text-center">Đang tải...</td></tr> : filteredBills.length === 0 ? (
                                            <tr><td colSpan={10} className="p-12 text-center text-gray-500">{bills.length === 0 ? "Chưa có dữ liệu" : "Không tìm thấy kết quả"}</td></tr>
                                        ) : (
                                            filteredBills.slice(0, visibleCount).map((bill, index) => {
                                                const isPrinted = !!bill.lastPrinted;
                                                const isActive = activeRowId === bill.id;
                                                let rowBgClass = isActive ? "bg-yellow-100" : isPrinted ? "bg-blue-100" : bill.total === 0 ? "bg-green-100" : bill.total < 10000 ? "bg-orange-100" : index % 2 === 0 ? "bg-gray-50" : "bg-white";

                                                // Important: Sticky cells must have opaque background matching the row
                                                const stickyCellClass = `${rowBgClass}`;

                                                return (
                                                    <tr key={bill.id} className={`${rowBgClass} hover:bg-yellow-50 cursor-pointer ${isActive ? "ring-2 ring-inset ring-yellow-300" : ""} transition-all duration-150`} onClick={() => setActiveRowId(bill.id)}>
                                                        <td className={`p-2 text-center sticky left-0 z-30 border-r border-gray-200/50 w-[45px] ${stickyCellClass}`}>
                                                            <button onClick={(e) => handlePrintClick(bill, e)} className={`px-2 py-1.5 rounded text-[10px] font-bold shadow-sm active:scale-95 transition-all whitespace-nowrap ${isPrinted ? 'bg-white text-blue-700 border border-blue-400' : 'bg-blue-600 text-white'}`}>IN</button>
                                                        </td>
                                                        {/* Frozen Customer Name Cell */}
                                                        <td className={`p-2 font-semibold text-blue-900 sticky left-[45px] z-20 border-r min-w-[130px] md:w-[150px] whitespace-normal break-words leading-tight shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] ${stickyCellClass}`}>
                                                            <div>{bill.customerName}</div>
                                                            <div className="md:hidden text-[10px] text-gray-500 font-normal mt-0.5 font-mono">{bill.paymentCode || bill.subscriberNumber}</div>
                                                            {bill.note && <div className="mt-0.5 text-[10px] text-gray-500 italic flex items-start gap-1"><StickyNote size={10} className="mt-0.5 shrink-0" /> <span className="line-clamp-2">{bill.note}</span></div>}
                                                            {bill.status && <div className="mt-0.5 inline-flex items-center gap-1 bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded font-bold border border-purple-200"><AlertTriangle size={8} /> {bill.status}</div>}
                                                        </td>
                                                        <td className="p-2 text-gray-600 min-w-[180px] whitespace-normal">
                                                            <div className="flex items-start gap-1.5">{bill.location && <a href={bill.location} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-blue-600 hover:text-blue-800 bg-blue-50 p-1 rounded-full shrink-0 flex items-center justify-center mt-0.5 shadow-sm border border-blue-100"><MapPin size={12} /></a>}<div className="line-clamp-2">{bill.address}</div></div>
                                                            <div className="md:hidden mt-1 flex items-center gap-1 text-[10px] text-gray-500"><Phone size={10} /> {bill.phone}</div>
                                                        </td>
                                                        <td className="p-2 min-w-[80px] whitespace-nowrap text-right align-top">
                                                            <div className="flex flex-col items-end gap-1">
                                                                <div className="relative group flex items-center justify-end w-full"><span className="text-red-600 font-bold">{formatMoney(bill.total)}</span><input type="number" key={`${bill.id}-total-${bill.total}`} className="absolute inset-0 opacity-0 focus:opacity-100 focus:bg-white focus:border focus:border-red-300 w-full text-right font-bold text-red-600 outline-none rounded p-1 text-base md:text-sm" defaultValue={bill.total} onBlur={(e) => handleTotalBlur(bill.id, e.target.value)} onClick={(e) => e.stopPropagation()} /></div>
                                                                {bill.qrLink && <a href={bill.qrLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-green-600 hover:text-green-800 bg-green-50 p-1 rounded-full shrink-0 flex items-center justify-center border border-green-200"><DollarSign size={12} /></a>}
                                                            </div>
                                                        </td>
                                                        <td className="hidden md:table-cell p-2 text-gray-500 text-xs">{bill.paymentCode}</td>
                                                        <td className="hidden md:table-cell p-2 text-gray-500 text-xs">{bill.phone}</td>
                                                        <td className="hidden md:table-cell p-2 min-w-[140px]"><input type="text" key={`${bill.id}-note-${bill.note}`} className="w-full border border-gray-200 rounded px-1 py-1 bg-white/50 focus:bg-white focus:border-blue-500 outline-none text-xs shadow-sm truncate" placeholder="..." defaultValue={bill.note} onBlur={(e) => handleNoteBlur(bill.id, e.target.value)} onClick={(e) => e.stopPropagation()} /></td>
                                                        <td className="p-2 text-center"><button onClick={(e) => handleEditClick(bill, e)} className="text-gray-400 hover:text-blue-600 p-1 rounded-full hover:bg-blue-50 transition-colors"><Info size={16} /></button></td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                        {filteredBills.length > visibleCount && <tr><td colSpan={10} className="p-4 text-center text-xs text-gray-400 bg-gray-50 italic">Đang hiển thị {visibleCount} / {filteredBills.length} kết quả.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </main>
                )}
            </div>

            {isCreating && <BillModal bill={emptyBillTemplate()} title="Tạo Hóa Đơn Mới" onClose={() => setIsCreating(false)} onSave={handleSaveNewBill} />}
            {editingBill && <BillModal bill={editingBill} title="Chi tiết & Chỉnh sửa" onClose={() => setEditingBill(null)} onSave={handleSaveEditedBill} />}

            {showPrintModal && selectedBill && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-3 bg-gray-100 border-b flex justify-between items-center"><span className="font-bold flex items-center gap-2"><Printer className="w-4 h-4" /> In Hóa Đơn</span><button onClick={closePrintModal}><X className="w-6 h-6 text-gray-500" /></button></div>
                        <div className="p-4 bg-gray-50 border-b">
                            <div className="flex justify-between items-center mb-3">
                                <div className="flex items-center gap-2 text-sm"><Bluetooth className={isBtSupported ? "text-blue-600" : "text-gray-400"} size={18} /><span className="font-medium">{btDeviceName || "Chưa kết nối"}</span></div>
                                {isBtSupported && !btDeviceName && <button onClick={handleConnectBluetooth} className="text-xs bg-white border border-blue-600 text-blue-600 px-3 py-1 rounded-full font-bold">KẾT NỐI</button>}
                            </div>
                            {btError && <p className="text-xs text-red-600 bg-red-50 p-2 rounded mb-2">{btError}</p>}
                            {isBtSupported && (
                                <div className="flex flex-col gap-3">
                                    <button onClick={handleDirectBluetoothPrint} disabled={isPrinting || !btDeviceName} className={`w-full py-4 rounded-xl font-bold text-lg shadow-md flex justify-center items-center gap-2 transition-transform active:scale-95 ${btDeviceName ? 'bg-blue-700 text-white hover:bg-blue-800' : 'bg-gray-300 text-gray-500'}`}>
                                        {isPrinting ? <Loader2 className="animate-spin" /> : <Printer size={24} />} {isPrinting ? 'ĐANG XỬ LÝ...' : 'IN HÓA ĐƠN'}
                                    </button>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button onClick={handlePrintThenPin} disabled={isPrinting || !btDeviceName} className={`py-3 rounded-lg font-bold text-sm shadow flex justify-center items-center gap-2 ${btDeviceName ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-300 text-gray-500'}`}>
                                            <MapPin size={18} /> GHIM & IN NHANH
                                        </button>
                                        <button onClick={() => handleActionPrintQR(selectedBill)} disabled={isPrinting || !btDeviceName} className={`py-3 rounded-lg font-bold text-sm shadow flex justify-center items-center gap-2 ${btDeviceName ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-300 text-gray-500'}`}><QrCode size={18} /> IN QR</button>
                                        <button onClick={() => handleActionPrintFault(selectedBill)} disabled={isPrinting || !btDeviceName} className={`col-span-2 py-3 rounded-lg font-bold text-sm shadow flex justify-center items-center gap-2 ${btDeviceName ? 'bg-orange-600 text-white hover:bg-orange-700' : 'bg-gray-300 text-gray-500'}`}>
                                            <Wrench size={18} /> BÁO HỎNG
                                        </button>
                                    </div>
                                    <button onClick={handlePinLocationOnly} disabled={isPrinting} className="w-full py-2 rounded border border-gray-300 bg-white text-gray-700 font-bold text-xs hover:bg-gray-100 flex items-center justify-center gap-1">
                                        <Navigation size={14} /> CHỈ GHIM VỊ TRÍ
                                    </button>
                                    {gpsSignal && <div className="text-center text-[10px] text-gray-500">Độ chính xác GPS hiện tại: <span className={gpsSignal.acc < 10 ? 'text-green-600 font-bold' : 'text-orange-500'}>{Math.round(gpsSignal.acc)}m</span></div>}
                                </div>
                            )}
                        </div>
                        <div className="bg-gray-200 p-4 overflow-y-auto flex-1 flex justify-center"><div className="shadow-lg bg-white shrink-0"><Receipt bill={selectedBill} paperSize="58mm" /></div></div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
