"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  CreditCard,
  Image as ImageIcon,
  Gem,
  CheckCircle2,
  Gift,
  Loader2,
  X,
  ChevronDown,
  Eye,
  EyeOff,
  Crown,
  Zap,
  Settings,
  ArrowRight
} from "lucide-react";
import { motion } from "framer-motion";
import {
  BillingCycle,
  SubscriptionPlan,
  CREDIT_PACKS,
  getSubscriptionPricing as getPricing,
  getSubscriptionPurchaseUrl,
} from "@/lib/billing";

export default function ProfilePage() {
  return <ProfilePageContent />;
}

function ProfilePageContent() {
  const searchParams = useSearchParams();
  // 自动识别标签
  const activeTab = searchParams.get('tab') || 'account';
  
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

  const isSubscriptionActive = (expiresAt?: string | null) => {
    return Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now());
  };

  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const activeSubscriptionType = isSubscriptionActive(profile?.subscription_expires_at)
    ? profile?.subscription_type
    : 'free';
  
  // 兑换弹窗状态
  const [isRedeemModalOpen, setIsRedeemModalOpen] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);

  // BYOK 状态
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [customApiKey, setCustomApiKey] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModelName, setCustomModelName] = useState('');
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isSavingByok, setIsSavingByok] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isEditingByok, setIsEditingByok] = useState(true);
  const [isPresetMenuOpen, setIsPresetMenuOpen] = useState(false);
  const presetMenuRef = useRef<HTMLDivElement>(null);

  // 表单错误状态
  const [formErrors, setFormErrors] = useState({
      baseUrl: '',
      modelName: '',
      apiKey: ''
  });

  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' | null }>({ message: '', type: null });

    // 显示 Toast 提示
    const showToast = (message: string, type: 'success' | 'error' | 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast({ message: '', type: null }), 3000);
    };

  // 购买跳转逻辑
    const handlePurchase = (plan: SubscriptionPlan, cycle: BillingCycle) => {
        const targetUrl = getSubscriptionPurchaseUrl(plan, cycle);
        if (targetUrl) {
            window.open(targetUrl, '_blank');
        } else {
            showToast('该方案购买链接配置中，请稍后或使用兑换码', 'error');
        }
    };

    // 初始化加载
    useEffect(() => {
      const initData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        window.location.replace('/login');
        return;
      }

      setUser(session.user);
      
      // 先执行积分同步（处理每日赠送逻辑）
      await supabase.rpc('sync_user_credits', { user_uuid: session.user.id });
      
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();

      if (data) {
          setProfile(data);
          // 初始化 BYOK 表单
          setUseCustomModel(data.use_custom_model || false);
          setCustomApiKey(data.custom_api_key || '');
          setCustomBaseUrl(data.custom_base_url || '');
          setCustomModelName(data.custom_model_name || '');
          // 如果有配置，则进入锁定状态
          if (data.custom_api_key) setIsEditingByok(false);
      }
      
      setIsLoading(false);
    };

    initData();
  }, []);

  // 即时切换 BYOK 开关
  const toggleUseCustomModel = async (newValue: boolean) => {
      // 权限检查：必须是 Basic 或 Pro 会员且在有效期内
      if (newValue) {
          const isValid = activeSubscriptionType === 'basic' || activeSubscriptionType === 'pro';
          
          if (!isValid) {
              showToast('BYOK 模式仅限基础版/专业版会员使用，请前往升级订阅。', 'error');
              return;
          }
      }

      // 乐观更新
      setUseCustomModel(newValue);
      
      try {
          const { error } = await supabase
              .from('profiles')
              .update({ use_custom_model: newValue })
              .eq('id', user.id);
          
          if (error) throw error;
          
          // 刷新 profile 状态
          setProfile((prev: any) => ({
              ...prev,
              use_custom_model: newValue
          }));
          
          // 轻量提示
          showToast('BYOK 状态已更新', 'success');
      } catch (err: any) {
          console.error('Toggle BYOK failed:', err);
          // 回滚
          setUseCustomModel(!newValue);
          showToast('状态更新失败：' + (err.message || '未知错误'), 'error');
      }
  };

  // 点击外部清除错误 & 关闭预设菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // 1. 关闭预设菜单
      if (presetMenuRef.current && !presetMenuRef.current.contains(event.target as Node)) {
        setIsPresetMenuOpen(false);
      }

      // 2. 清除表单错误 (如果点击的不是输入框或按钮)
      const target = event.target as HTMLElement;
      const isInput = target.closest('input');
      const isSaveButton = target.closest('button') && target.textContent?.includes('保存设置');
      
      // 检查是否有错误存在
      const hasErrors = Object.values(formErrors).some(err => err !== '');
      
      if (hasErrors && !isInput && !isSaveButton) {
          setFormErrors({ baseUrl: '', modelName: '', apiKey: '' });
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [formErrors]);

  // 保存 BYOK 设置 (仅参数)
  const handleSaveParams = async () => {
      const nextCustomApiKey = customApiKey.trim();
      const nextCustomBaseUrl = customBaseUrl.trim().replace(/\/+$/, '');
      const nextCustomModelName = customModelName.trim();

      // 校验逻辑
      const errors = {
          baseUrl: '',
          modelName: '',
          apiKey: ''
      };
      let hasError = false;
      setSaveError(''); // 清除之前的错误

      if (!nextCustomBaseUrl) {
          errors.baseUrl = '未输入 Base URL';
          hasError = true;
      }
      if (!nextCustomModelName) {
          errors.modelName = '未输入模型名称';
          hasError = true;
      }
      if (!nextCustomApiKey) {
          errors.apiKey = '未输入 API Key';
          hasError = true;
      }

      setFormErrors(errors);
      if (hasError) return;

      setIsSavingByok(true);
      setSaveSuccess(false);
      
      try {
          const { error } = await supabase
              .from('profiles')
              .update({
                  custom_api_key: nextCustomApiKey,
                  custom_base_url: nextCustomBaseUrl,
                  custom_model_name: nextCustomModelName
              })
              .eq('id', user.id);
          
          if (error) throw error;
          
          // 刷新 profile 状态
          setProfile((prev: any) => ({
              ...prev,
              custom_api_key: nextCustomApiKey,
              custom_base_url: nextCustomBaseUrl,
              custom_model_name: nextCustomModelName
          }));
          setCustomApiKey(nextCustomApiKey);
          setCustomBaseUrl(nextCustomBaseUrl);
          setCustomModelName(nextCustomModelName);
          
          // 成功反馈
          setSaveSuccess(true);
          setIsEditingByok(false);
          
          // 3秒后重置成功状态
          setTimeout(() => setSaveSuccess(false), 3000);
      } catch (err: any) {
          console.error('Save Params failed:', err);
          setSaveError('保存失败，请检查网络后重试');
      } finally {
          setIsSavingByok(false);
      }
  };
  // 快捷填入
  const fillPreset = (type: string) => {
      // 清空错误
      setFormErrors({ baseUrl: '', modelName: '', apiKey: '' });

      let url = '';
      if (type === 'custom') {
          setCustomBaseUrl('https://');
          setCustomModelName('');
          setCustomApiKey('');
          setIsPresetMenuOpen(false);
          return;
      }

      switch (type) {
          case 'qwen': url = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'; break;
          case 'doubao': url = 'https://ark.cn-beijing.volces.com/api/v3'; break;
          case 'kimi': url = 'https://api.moonshot.cn/v1'; break;
          case 'gemini': url = 'https://generativelanguage.googleapis.com/v1beta/openai'; break;
          case 'minimax': url = 'https://api.minimaxi.com/v1'; break;
          case 'openai': url = 'https://api.openai.com/v1'; break;
      }
      if (url) setCustomBaseUrl(url);
      setIsPresetMenuOpen(false);
  };

  // 兑换积分/会员逻辑
  const handleRedeem = async () => {
    if (!redeemCode || redeemCode.length < 5) {
        showToast('请输入有效的兑换码', 'error');
        return;
    }
    
    setIsRedeeming(true);
    
    try {
        // 1. 尝试兑换积分
        // 注意：rpc 返回 table 时，data 是一个数组
        const { data: creditData, error: creditError } = await supabase.rpc('redeem_code', {
            code_input: redeemCode,
            user_uuid: user.id
        });

        // 处理可能的数组返回
        const creditResult = Array.isArray(creditData) ? creditData[0] : creditData;
        
        // 如果是积分兑换码且成功
        if (!creditError && creditResult && creditResult.success) {
            showToast(`🎉 兑换成功！获得 ${creditResult.points} 积分`, 'success');
            setProfile((prev: any) => ({ ...prev, permanent_credits: (prev.permanent_credits || 0) + creditResult.points }));
            setIsRedeemModalOpen(false);
            setRedeemCode('');
            return;
        }

        // 如果只是无效兑换码，尝试调用 redeem_membership
        // 如果 creditError 存在但不是业务逻辑错误（例如网络错误），则抛出
        if (creditError) throw creditError;

        // 如果 creditResult.success 为 false，且是因为找不到码，则尝试会员码
        if (!creditResult?.success) {
             const { data: memData, error: memError } = await supabase.rpc('redeem_membership', {
                code_input: redeemCode,
                user_uuid: user.id
            });

            if (memError) throw memError;

            const memResult = Array.isArray(memData) ? memData[0] : memData;

            if (memResult && memResult.success) {
                const tierName = memResult.tier === 'pro' ? '高级会员 Pro' : '基础会员 Basic';
                showToast(`🎉 兑换成功！已激活 ${tierName} (${memResult.days}天)`, 'success');
                
                // 刷新 Profile
                const { data: newProfile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
                if (newProfile) setProfile(newProfile);

                setIsRedeemModalOpen(false);
                setRedeemCode('');
            } else {
                // 如果会员码也失败，显示错误信息
                // 如果两个都失败，且信息都是无效码，显示无效码
                showToast(`❌ ${memResult?.message || creditResult?.message || '无效的兑换码'}`, 'error');
            }
        }

    } catch (err: any) {
        console.error('Redeem failed:', err);
        showToast('兑换失败：' + (err.message || '未知错误'), 'error');
    } finally {
        setIsRedeeming(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#FDFCF8]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="relative w-16 h-16 flex items-center justify-center"
        >
          <motion.svg
            width="48"
            height="48"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="stroke-emerald-500"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <motion.path
              d="M 20 80 L 20 20 L 50 50 L 80 20 L 80 80"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{
                duration: 0.25,
                ease: "easeInOut",
                repeat: Infinity,
                repeatType: "reverse", // 往返绘制
                repeatDelay: 0.2
              }}
            />
          </motion.svg>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FDFCF8] font-sans text-stone-800 selection:bg-emerald-100 selection:text-emerald-900 p-10 relative">
      {/* Toast Notification */}
      {toast.type && (
        <motion.div
            initial={{ opacity: 0, y: -50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className={`fixed top-10 left-1/2 z-[10001] px-6 py-3 rounded-full backdrop-blur-md shadow-lg border flex items-center gap-2 ${
                toast.type === 'success' 
                ? 'bg-emerald-50/90 border-emerald-200 text-emerald-700' 
                : 'bg-red-50/90 border-red-200 text-red-600'
            }`}
        >
            {toast.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 stroke-[3]" />
            ) : (
                <X className="w-4 h-4 stroke-[3]" />
            )}
            <span className="text-sm font-bold">{toast.message}</span>
        </motion.div>
      )}

      {/* 
        不再渲染 Left Sidebar (已移至 Layout)
        也不再需要 ml-64，因为 Layout 会处理 flex 布局
      */}
      
      <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Tab: 账户信息 */}
        {activeTab === 'account' && (
            <div className="space-y-6">
                <h1 className="text-2xl font-black text-stone-800">账户信息</h1>
                <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">用户 ID</label>
                            <div className="font-mono text-sm bg-stone-50 p-3 rounded-lg text-stone-600 border border-stone-100 truncate select-all">
                                {user?.id}
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">当前会员</label>
                            <div className="font-black text-emerald-600 text-xl p-3 flex items-center gap-2">
                                {activeSubscriptionType === 'pro' ? <Crown className="w-5 h-5 text-emerald-500" /> : 
                                 activeSubscriptionType === 'basic' ? <Zap className="w-5 h-5 text-teal-500" /> :
                                 <span className="text-stone-400 text-sm font-bold">体验版</span>}
                                <span className="capitalize">{activeSubscriptionType === 'free' ? 'Free' : activeSubscriptionType}</span>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">会员到期</label>
                            <div className="font-medium text-stone-700 p-3">
                                {profile?.subscription_expires_at
                                  ? isSubscriptionActive(profile.subscription_expires_at)
                                    ? new Date(profile.subscription_expires_at).toLocaleDateString('zh-CN')
                                    : `已过期 (${new Date(profile.subscription_expires_at).toLocaleDateString('zh-CN')})`
                                  : '永久有效'}
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">本月赠送积分</label>
                            <div className="font-black text-stone-700 text-xl p-3">
                                {profile?.monthly_credits || 0}
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">永久积分余额</label>
                            <div className="font-black text-stone-700 text-xl p-3 flex items-center gap-2">
                                <Gem className="w-5 h-5 text-orange-500" />
                                {profile?.permanent_credits || 0}
                            </div>
                        </div>
                    </div>
                </div>
                {/* BYOK 设置面板 */}
                <div className="bg-white rounded-2xl shadow-sm border border-stone-100 pt-9 px-6 pb-3">
                    <div className="flex items-center justify-between mb-6 h-[50px]">
                        <div className="flex items-center gap-3 h-full">
                             <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 flex-shrink-0">
                                 <Loader2 className={`w-6 h-6 ${isSavingByok ? 'animate-spin' : ''}`} />
                             </div>
                             <div className="flex flex-col justify-center h-full">
                                 <div className="flex items-center gap-2 mb-1">
                                     <h2 className="text-lg font-black text-stone-800 leading-none">开发者设置 (BYOK)</h2>
                                     <a 
                                         href="https://dcnql2nounts.feishu.cn/docx/OEbXdheS3oxfqyxNy7Zc3ksUnJb" 
                                         target="_blank" 
                                         rel="noopener noreferrer"
                                         className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-0.5 bg-emerald-50 px-2 py-0.5 rounded-full transition-colors"
                                     >
                                         配置教程 <ArrowRight className="w-3 h-3" />
                                     </a>
                                 </div>
                                 <p className="text-xs text-stone-400 font-bold leading-none mb-0">Bring Your Own Key</p>
                             </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer h-full">
                            <input 
                                type="checkbox" 
                                className="sr-only peer"
                                checked={useCustomModel}
                                onChange={(e) => toggleUseCustomModel(e.target.checked)}
                            />
                            <div className="w-11 h-6 bg-stone-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-100 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[calc(50%-10px)] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500 flex items-center"></div>
                        </label>
                    </div>

                    {useCustomModel && (
                        <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
                            <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 text-xs font-bold text-amber-700 flex items-start gap-2">
                                <span className="text-lg">💡</span>
                                <div className="leading-relaxed">
                                    开启此模式后，生成演示将不再消耗平台积分，但您需要自行承担模型服务商的费用。<br/>
                                    请确保您的 API Key 具有足够的额度。
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-1">
                                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Base URL (API Endpoint)</label>
                                    <div className="relative" ref={presetMenuRef}>
                                        <input 
                                            type="text" 
                                            value={customBaseUrl}
                                            disabled={!isEditingByok}
                                            onChange={(e) => {
                                                setCustomBaseUrl(e.target.value);
                                                if (e.target.value.trim()) setFormErrors(prev => ({ ...prev, baseUrl: '' }));
                                            }}
                                            placeholder="例如: https://api.openai.com/v1"
                                            className={`w-full pl-4 pr-32 py-3 bg-stone-50 border-2 rounded-xl text-sm font-mono text-stone-700 focus:outline-none focus:bg-white transition-all ${
                                                formErrors.baseUrl 
                                                ? 'border-red-500 focus:border-red-500 bg-red-50' 
                                                : !isEditingByok 
                                                    ? 'border-stone-100 bg-stone-100/50 text-stone-400 cursor-not-allowed'
                                                    : 'border-stone-100 focus:border-indigo-500'
                                            }`}
                                        />
                                        <div className="absolute right-1 top-1 bottom-1">
                                            <button 
                                                onClick={() => isEditingByok && setIsPresetMenuOpen(!isPresetMenuOpen)}
                                                disabled={!isEditingByok}
                                                className={`h-full px-3 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                                                    !isEditingByok 
                                                    ? 'bg-stone-100 text-stone-400 cursor-not-allowed' 
                                                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                                                }`}
                                            >
                                                选择预设 <ChevronDown className={`w-3 h-3 transition-transform ${isPresetMenuOpen ? 'rotate-180' : ''}`} />
                                            </button>
                                        </div>

                                        {/* Dropdown Menu */}
                                        {isPresetMenuOpen && (
                                            <div className="absolute right-0 top-[calc(100%+8px)] w-48 bg-white/95 backdrop-blur-md rounded-xl shadow-xl border border-stone-100/50 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                                <div className="py-1">
                                                    {[
                                                        { id: 'qwen', label: '通义千问' },
                                                        { id: 'doubao', label: '豆包' },
                                                        { id: 'kimi', label: 'Kimi' },
                                                        { id: 'gemini', label: 'Gemini' },
                                                        { id: 'minimax', label: 'Minimax' },
                                                        { id: 'openai', label: 'OpenAI' },
                                                        { id: 'custom', label: '自定义' },
                                                    ].map(preset => (
                                                        <button 
                                                            key={preset.id}
                                                            onClick={() => fillPreset(preset.id)}
                                                            className={`w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-emerald-50 hover:text-emerald-700 transition-colors ${preset.id === 'custom' ? 'border-t border-stone-100 text-stone-500' : 'text-stone-700'}`}
                                                        >
                                                            {preset.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    {formErrors.baseUrl && <p className="text-xs font-bold text-red-500 pl-1">{formErrors.baseUrl}</p>}
                                </div>

                                <div className="space-y-1">
                                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider">Model Name (模型名称)</label>
                                    <input 
                                        type="text" 
                                        value={customModelName}
                                        disabled={!isEditingByok}
                                        onChange={(e) => {
                                            setCustomModelName(e.target.value);
                                            if (e.target.value.trim()) setFormErrors(prev => ({ ...prev, modelName: '' }));
                                        }}
                                        placeholder="输入任意支持多模态的模型名称 (如 gpt-4o, qwen-vl-max)"
                                        className={`w-full px-4 py-3 bg-stone-50 border-2 rounded-xl text-sm font-mono text-stone-700 focus:outline-none focus:bg-white transition-all ${
                                            formErrors.modelName 
                                            ? 'border-red-500 focus:border-red-500 bg-red-50' 
                                            : !isEditingByok 
                                                ? 'border-stone-100 bg-stone-100/50 text-stone-400 cursor-not-allowed'
                                                : 'border-stone-100 focus:border-indigo-500'
                                        }`}
                                    />
                                    {formErrors.modelName && <p className="text-xs font-bold text-red-500 pl-1">{formErrors.modelName}</p>}
                                </div>

                                <div className="space-y-1 relative">
                                    <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">API Key (密钥)</label>
                                    <div className="relative">
                                        <input 
                                            type={isApiKeyVisible ? "text" : "password"} 
                                            value={customApiKey}
                                            disabled={!isEditingByok}
                                            onChange={(e) => {
                                                setCustomApiKey(e.target.value);
                                                if (e.target.value.trim()) setFormErrors(prev => ({ ...prev, apiKey: '' }));
                                            }}
                                            placeholder="sk-..."
                                            className={`w-full pl-4 pr-12 py-3 bg-stone-50 border-2 rounded-xl text-sm font-mono text-stone-700 focus:outline-none focus:bg-white transition-all [&::-ms-reveal]:hidden [&::-ms-clear]:hidden ${
                                                formErrors.apiKey 
                                                ? 'border-red-500 focus:border-red-500 bg-red-50' 
                                                : !isEditingByok 
                                                    ? 'border-stone-100 bg-stone-100/50 text-stone-400 cursor-not-allowed'
                                                    : 'border-stone-100 focus:border-indigo-500'
                                            }`}
                                        />
                                        {customApiKey.length > 0 && (
                                            <button 
                                                type="button"
                                                onClick={() => setIsApiKeyVisible(!isApiKeyVisible)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-emerald-500 transition-colors focus:outline-none"
                                                tabIndex={-1}
                                            >
                                                {isApiKeyVisible ? (
                                                    <Eye className="w-4 h-4" />
                                                ) : (
                                                    <EyeOff className="w-4 h-4" />
                                                )}
                                            </button>
                                        )}
                                    </div>
                                    {formErrors.apiKey && <p className="text-xs font-bold text-red-500 pl-1">{formErrors.apiKey}</p>}
                                </div>
                            </div>

                            <div className="flex flex-col items-end gap-2 pt-4">
                                <div className="flex items-center gap-3">
                                    {!isEditingByok && (
                                        <button 
                                            onClick={() => setIsEditingByok(true)}
                                            className="h-10 px-6 flex items-center justify-center bg-white border border-emerald-500 text-emerald-600 hover:bg-emerald-50 rounded-full text-sm font-medium transition-all"
                                        >
                                            编辑
                                        </button>
                                    )}
                                    <button 
                                        onClick={handleSaveParams}
                                        disabled={!isEditingByok || isSavingByok}
                                        className={`h-10 px-6 flex items-center justify-center rounded-full text-sm font-medium transition-all gap-2 ${
                                            !isEditingByok
                                            ? 'bg-zinc-200 text-zinc-500 cursor-not-allowed shadow-none'
                                            : 'bg-zinc-900 hover:bg-black text-white active:scale-95 shadow-lg'
                                        }`}
                                    >
                                        {isSavingByok ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                <span>保存中...</span>
                                            </>
                                        ) : (!isEditingByok ? "已保存" : "保存设置")}
                                    </button>
                                </div>
                                {saveError && (
                                    <p className="text-xs font-bold text-red-500 animate-in fade-in slide-in-from-top-1">
                                        {saveError}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* Tab: 积分与充值 */}
        {activeTab === 'credits' && (
            <div className="space-y-8">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-black text-stone-800">积分中心</h1>
                    <button 
                        onClick={() => setIsRedeemModalOpen(true)}
                        className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-full font-bold text-sm shadow-lg shadow-emerald-200 transition-all flex items-center gap-2"
                    >
                        <Gift className="w-4 h-4" /> 使用兑换码
                    </button>
                </div>

                {/* 余额卡片 */}
                <div className="bg-gradient-to-br from-stone-900 to-stone-800 rounded-2xl p-8 text-white shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500 rounded-full blur-[80px] opacity-20 -mr-16 -mt-16"></div>
                    <div className="relative z-10 flex items-center justify-between">
                        <div>
                            <div className="text-stone-400 font-bold text-sm mb-2">当前可用积分</div>
                            <div className="text-5xl font-black font-mono tracking-tight flex items-baseline gap-2">
                                {(profile?.monthly_credits || 0) + (profile?.permanent_credits || 0)}
                                <span className="text-lg font-bold text-stone-500">pts</span>
                            </div>
                        </div>
                        {/* Billing Toggle - Pill Style */}
                        <div className="flex items-center gap-1 bg-stone-800/50 p-1 rounded-xl border border-stone-700/50 backdrop-blur-sm relative">
                            {[
                                { id: 'monthly', label: '月付' },
                                { id: 'quarterly', label: '季付', discount: '-10%', color: 'bg-orange-500' },
                                { id: 'annually', label: '年付', discount: '-20%', color: 'bg-red-500' },
                            ].map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => setBillingCycle(item.id as any)}
                                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 relative z-10 ${
                                        billingCycle === item.id 
                                        ? 'bg-stone-700 text-white shadow-sm' 
                                        : 'text-stone-400 hover:text-stone-300'
                                    }`}
                                >
                                    {item.label}
                                    {item.discount && (
                                        <span className={`${item.color} text-white text-[8px] px-1 py-0.5 rounded leading-none`}>
                                            {item.discount}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 充值套餐 */}
                <div className="space-y-8">
                    {/* 上部分：会员订阅方案 (Top Grid) */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
                        
                        {/* 卡片一：体验版 Free */}
                        <div className={`bg-white p-6 rounded-2xl border shadow-sm hover:shadow-md transition-all h-full flex flex-col group ${
                            activeSubscriptionType === 'free' ? 'border-emerald-500' : 'border-stone-100 hover:border-stone-200'
                        }`}>
                            <div className="mb-4">
                                <span className={`${
                                    activeSubscriptionType === 'free' ? 'bg-emerald-500 text-white' : 'bg-stone-100 text-stone-500'
                                } text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider`}>
                                    {activeSubscriptionType === 'free' ? '当前方案' : '体验版'}
                                </span>
                            </div>
                            <h3 className="text-xl font-black text-stone-800 mb-2">体验版 Free</h3>
                            <div className="text-stone-400 text-sm font-bold mb-6">零成本开启探索</div>
                            
                            <div className="flex items-baseline gap-1 mb-6">
                                <span className="text-3xl font-black text-stone-800">¥0</span>
                                <span className="text-stone-400 font-bold text-sm"> / 永久</span>
                            </div>

                            <div className="space-y-3 mb-8 flex-1">
                                <div className="flex items-start gap-2.5">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                                    <span className="text-sm font-bold text-stone-600">每天赠送 3 个积分</span>
                                </div>
                                <div className="flex items-start gap-2.5">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                                    <span className="text-sm font-bold text-stone-600">每日零点重置</span>
                                </div>
                                <div className="flex items-start gap-2.5">
                                    <X className="w-4 h-4 text-stone-300 flex-shrink-0 mt-0.5" />
                                    <span className="text-sm font-bold text-stone-400 line-through decoration-stone-300">不支持 BYOK</span>
                                </div>
                            </div>

                            {activeSubscriptionType === 'free' ? (
                                <button className="w-full py-3 bg-stone-50 text-stone-400 font-bold rounded-full text-sm cursor-not-allowed border border-stone-100 mt-auto">
                                    正在使用
                                </button>
                            ) : (
                                <button 
                                    disabled
                                    className="w-full py-3 bg-stone-50 text-stone-300 font-bold rounded-full text-sm border border-stone-100 mt-auto opacity-50"
                                >
                                    已激活更高方案
                                </button>
                            )}
                        </div>

                        {/* 卡片二：基础会员 Basic */}
                        <div className={`bg-white p-6 rounded-2xl border shadow-sm hover:shadow-md transition-all h-full flex flex-col group ${
                            activeSubscriptionType === 'basic' ? 'border-emerald-500' : 'border-stone-100 hover:border-emerald-200'
                        }`}>
                            <div className="mb-4">
                                <span className={`${
                                    activeSubscriptionType === 'basic' ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-600'
                                } text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider`}>
                                    {activeSubscriptionType === 'basic' ? '当前方案' : '自备 api Key'}
                                </span>
                            </div>
                            <h3 className="text-xl font-black text-stone-800 mb-2">基础会员 Basic</h3>
                            <div className="text-stone-400 text-sm font-bold mb-6">自备 Key 用户</div>
                            
                            <div className="flex items-baseline gap-1 mb-1">
                                <span className="text-3xl font-black text-stone-800">¥{getPricing('basic', billingCycle).total}</span>
                                <span className="text-stone-400 font-bold text-sm"> / {getPricing('basic', billingCycle).unit}</span>
                            </div>
                            <div className="text-[10px] text-stone-400 font-bold mb-6">
                                {billingCycle !== 'monthly' && `折合 ¥${getPricing('basic', billingCycle).avg} / 月`}
                            </div>

                            <div className="space-y-3 mb-8 flex-1">
                                <div className="flex items-start gap-2.5">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-stone-600">解锁 BYOK 模式</span>
                                        <span className="text-[10px] text-emerald-600 font-bold">支持 Qwen3.5 plus, Doubao-Seed 2.0</span>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2.5">
                                    <X className="w-4 h-4 text-stone-300 flex-shrink-0 mt-0.5" />
                                    <span className="text-sm font-bold text-stone-400">不赠送平台积分</span>
                                </div>
                            </div>

                            {activeSubscriptionType === 'basic' ? (
                                <button className="w-full py-3 bg-stone-50 text-stone-400 font-bold rounded-full text-sm cursor-not-allowed border border-stone-100 mt-auto">
                                    正在使用
                                </button>
                            ) : activeSubscriptionType === 'pro' ? (
                                <button 
                                    disabled
                                    className="w-full py-3 bg-stone-50 text-stone-300 font-bold rounded-full text-sm border border-stone-100 mt-auto opacity-50"
                                >
                                    已激活更高方案
                                </button>
                            ) : (
                                <button 
                                    onClick={() => handlePurchase('basic', billingCycle)}
                                    className="w-full py-3 bg-white border-2 border-stone-100 text-stone-600 font-bold rounded-full text-sm hover:border-emerald-400 hover:text-emerald-600 hover:shadow-md transition-all mt-auto"
                                >
                                    立即订阅
                                </button>
                            )}
                        </div>

                        {/* 卡片三：高级会员 Pro */}
                        <div className={`bg-white p-6 rounded-2xl shadow-sm hover:shadow-md transition-all relative z-10 flex flex-col h-full border-2 overflow-hidden ${
                            activeSubscriptionType === 'pro' ? 'border-emerald-500' : 'border-emerald-500'
                        }`}>
                            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-[40px] -mr-10 -mt-10 pointer-events-none"></div>
                            <div className="mb-4 flex justify-between items-start relative z-10">
                                <span className={`${
                                    activeSubscriptionType === 'pro' ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-700'
                                } text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider`}>
                                    {activeSubscriptionType === 'pro' ? '当前方案' : '全能版'}
                                </span>
                                <span className="bg-emerald-500 text-white text-[10px] font-black px-2 py-0.5 rounded shadow-sm flex items-center gap-1">
                                    <Crown className="w-3 h-3 fill-current" /> 最推荐
                                </span>
                            </div>
                            
                            <h3 className="text-xl font-black text-emerald-700 mb-2 relative z-10">高级会员 Pro</h3>
                            <div className="text-emerald-600/70 text-sm font-bold mb-6 relative z-10">算力与自由兼得</div>
                            
                            <div className="flex items-baseline gap-1 mb-1 relative z-10">
                                <span className="text-4xl font-black text-emerald-600 tracking-tight">
                                    ¥{getPricing('pro', billingCycle).total}
                                </span>
                                <span className="text-emerald-400 font-bold text-sm">
                                    / {getPricing('pro', billingCycle).unit}
                                </span>
                            </div>
                            <div className="text-[10px] text-emerald-600/60 font-bold mb-6 relative z-10">
                                {billingCycle !== 'monthly' && `折合 ¥${getPricing('pro', billingCycle).avg} / 月`}
                            </div>

                            <div className="space-y-3 mb-8 flex-1 relative z-10">
                                <div className="flex items-start gap-2.5">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                                    <span className="text-sm font-bold text-stone-600">每月赠送 <span className="text-emerald-600 text-base">60</span> 积分</span>
                                </div>
                                <div className="flex items-start gap-2.5">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-stone-600">解锁 BYOK 模式</span>
                                        <span className="text-[10px] text-emerald-600/80 font-bold">支持自定义 API Key</span>
                                    </div>
                                </div>
                            </div>

                            {activeSubscriptionType === 'pro' ? (
                                <button className="w-full py-3.5 bg-stone-50 text-stone-400 font-bold rounded-full text-sm cursor-not-allowed border border-stone-100 mt-auto relative z-10">
                                    正在使用
                                </button>
                            ) : (
                                <button 
                                    onClick={() => handlePurchase('pro', billingCycle)}
                                    className="w-full py-3.5 bg-emerald-500 text-white font-black rounded-full text-sm shadow-lg shadow-emerald-200 hover:bg-emerald-600 hover:shadow-emerald-300 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-auto relative z-10"
                                >
                                    <Zap className="w-4 h-4 fill-current" /> 立即升级
                                </button>
                            )}
                        </div>
                    </div>

                    {/* 下部分：积分加油包 (Bottom Section) */}
                    <div className="bg-stone-50 rounded-3xl p-8 border border-stone-200/50">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="bg-orange-100 p-2 rounded-xl">
                                <Zap className="w-6 h-6 text-orange-500 fill-current" />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-stone-800">积分加油包 (单次购买)</h3>
                                <p className="text-sm font-bold text-stone-400">按需购买，永久有效，不含 BYOK 权限</p>
                            </div>
                        </div>

                        <div className="flex flex-col gap-4">
                            {CREDIT_PACKS.map((pack) => (
                                <div key={pack.credits} className="flex items-center justify-between px-6 py-4 bg-white rounded-xl border border-stone-100 hover:shadow-sm transition-all group cursor-default">
                                    <div className="flex items-center gap-3">
                                        <span className="text-lg font-black text-stone-800">
                                            {pack.credits} 积分
                                        </span>
                                        <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                                            {pack.name}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-6">
                                        <span className="text-xl font-black text-stone-800">¥{pack.price}</span>
                                        <button 
                                            onClick={() => {
                                                if (pack.url) {
                                                    window.open(pack.url, '_blank');
                                                } else {
                                                    showToast('该积分包购买链接配置中，请稍后或使用兑换码', 'error');
                                                }
                                            }}
                                            className="px-6 py-2 border border-emerald-500 text-emerald-600 font-bold rounded-lg text-sm hover:bg-emerald-50 transition-all whitespace-nowrap"
                                        >
                                            购买
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        )}

      </div>

      {/* 兑换弹窗 (复用) */}
      {isRedeemModalOpen && (
          <div 
              className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200"
          >
              <div 
                  className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 border border-stone-100 relative"
                  onClick={(e) => e.stopPropagation()}
              >
                  <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl font-black text-stone-800">使用兑换码</h3>
                      <button 
                          onClick={() => setIsRedeemModalOpen(false)}
                          className="p-2 -mr-2 -mt-2 hover:bg-stone-100 rounded-full text-stone-400 hover:text-stone-600 transition-colors"
                      >
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  
                  <div className="space-y-6">
                      <div className="space-y-2">
                          <label className="text-xs font-bold text-stone-400 uppercase tracking-wider pl-1">卡密兑换码</label>
                          <input 
                              type="text" 
                              value={redeemCode}
                              onChange={(e) => setRedeemCode(e.target.value.trim())}
                              placeholder="请输入积分或会员兑换码"
                              className="w-full px-4 py-3.5 bg-stone-50 border-2 border-stone-100 rounded-xl text-base font-bold text-stone-700 placeholder:text-stone-300 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all font-mono tracking-wider text-center"
                          />
                      </div>
                      
                      <button 
                          onClick={handleRedeem}
                          disabled={isRedeeming || !redeemCode}
                          className="w-full py-3.5 bg-emerald-500 text-white rounded-full font-black text-base shadow-lg shadow-emerald-200 hover:bg-emerald-600 hover:shadow-emerald-300 hover:-translate-y-0.5 active:translate-y-0 disabled:bg-stone-200 disabled:shadow-none disabled:text-stone-400 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                      >
                          {isRedeeming ? <Loader2 className="w-5 h-5 animate-spin" /> : "立即兑换"}
                      </button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}
